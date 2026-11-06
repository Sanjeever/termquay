package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Sanjeever/termquay/internal/store"
)

func (a *AppService) CreateAIConversation(ctx context.Context, workspace string) (store.AIConversation, error) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	owner, err := a.aiAvailable(workspace)
	if err != nil {
		return store.AIConversation{}, err
	}
	if run := a.aiRuns[workspace]; run != nil {
		run.cancel()
		<-run.done
	}
	c := store.AIConversation{ID: aiID(), Archive: aiArchive(owner, workspace), ConnectionID: owner.connectionID, Target: owner.target, Title: "新对话", CreatedAt: time.Now().UnixMilli(), UpdatedAt: time.Now().UnixMilli()}
	a.storeMu.Lock()
	err = a.store.CreateAIConversation(ctx, c)
	a.storeMu.Unlock()
	if err != nil {
		return store.AIConversation{}, err
	}
	if a.aiCurrent == nil {
		a.aiCurrent = map[string]aiWorkspaceConversation{}
	}
	a.aiCurrent[workspace] = aiWorkspaceConversation{owner: owner, id: c.ID}
	delete(a.aiRuns, workspace)
	return c, nil
}

func (a *AppService) ListAIConversations(ctx context.Context, workspace string, offset, limit int) ([]store.AIConversation, error) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	owner, err := a.aiAvailable(workspace)
	if err != nil {
		return nil, err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	return a.store.ListAIConversations(ctx, aiArchive(owner, workspace), offset, limit)
}

func (a *AppService) GetAIConversation(ctx context.Context, workspace, id string, before, limit int) (AIConversationPage, error) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	owner, err := a.aiAvailable(workspace)
	if err != nil {
		return AIConversationPage{}, err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	c, err := a.store.AIConversation(ctx, id)
	if err != nil {
		return AIConversationPage{}, err
	}
	if c.Archive != aiArchive(owner, workspace) {
		return AIConversationPage{}, errors.New("AI 历史不属于当前连接")
	}
	items, err := a.store.AIMessages(ctx, id, before, limit)
	if err != nil {
		return AIConversationPage{}, err
	}
	page := AIConversationPage{Conversation: c, CurrentTarget: owner.target, Messages: []AIMessage{}, HasMore: len(items) == limit && items[0].Seq > 1}
	for _, item := range items {
		var message AIMessage
		if err := json.Unmarshal([]byte(item.Data), &message); err != nil {
			return AIConversationPage{}, err
		}
		message.Seq = item.Seq
		message.Message.Native = ""
		page.Messages = append(page.Messages, message)
	}
	return page, nil
}

func (a *AppService) OpenAIConversation(ctx context.Context, workspace, id string) error {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	owner, err := a.aiAvailable(workspace)
	if err != nil {
		return err
	}
	a.storeMu.Lock()
	c, err := a.store.AIConversation(ctx, id)
	a.storeMu.Unlock()
	if err != nil {
		return err
	}
	if c.Archive != aiArchive(owner, workspace) {
		return errors.New("AI 历史不属于当前连接")
	}
	for other, current := range a.aiCurrent {
		if other != workspace && current.id == id {
			if _, err := a.aiOwner(other, current.owner); err == nil {
				return errors.New("此对话已在另一个工作区打开，请新建对话")
			}
		}
	}
	if run := a.aiRuns[workspace]; run != nil {
		run.cancel()
		<-run.done
	}
	if a.aiCurrent == nil {
		a.aiCurrent = map[string]aiWorkspaceConversation{}
	}
	a.aiCurrent[workspace] = aiWorkspaceConversation{owner: owner, id: id}
	delete(a.aiRuns, workspace)
	return nil
}

func (a *AppService) DeleteAIConversation(ctx context.Context, workspace, id string) error {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	owner, err := a.aiAvailable(workspace)
	if err != nil {
		return err
	}
	a.storeMu.Lock()
	c, err := a.store.AIConversation(ctx, id)
	a.storeMu.Unlock()
	if err != nil {
		return err
	}
	if c.Archive != aiArchive(owner, workspace) {
		return errors.New("AI 历史不属于当前连接")
	}
	for _, run := range a.aiRuns {
		if run.view.ConversationID == id {
			run.cancel()
			<-run.done
		}
	}
	a.storeMu.Lock()
	err = a.store.DeleteAIConversation(ctx, id)
	a.storeMu.Unlock()
	if err != nil {
		return err
	}
	for key, current := range a.aiCurrent {
		if current.id == id {
			delete(a.aiCurrent, key)
			delete(a.aiRuns, key)
		}
	}
	return nil
}
