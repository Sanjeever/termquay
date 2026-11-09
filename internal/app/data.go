package app

import (
	"encoding/base64"

	"sort"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/store"
)

type Catalog struct {
	Groups      []store.Group      `json:"groups"`
	Connections []store.Connection `json:"connections"`
	SessionOnly bool               `json:"session_only"`
}

func (a *AppService) GetCatalog() (Catalog, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return Catalog{}, err
	}
	groups, connections, err := a.store.ReadCatalog()
	return Catalog{Groups: groups, Connections: connections, SessionOnly: a.sessionDir != ""}, err
}

func (a *AppService) SaveGroup(g store.Group) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	if g.ID == "" {
		g.ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
	}
	found := false
	for i, old := range d.Groups {
		if old.ID == g.ID {
			d.Groups[i] = g
			found = true
			break
		}
	}
	if !found {
		d.Groups = append(d.Groups, g)
	}
	return a.store.Replace(d)
}

func (a *AppService) DeleteGroup(id string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	groups := d.Groups[:0]
	for _, g := range d.Groups {
		if g.ParentID == id {
			return appmessage.New("backend:groupStillContainsSubgroups", "分组仍有子分组")
		}
		if g.ID != id {
			groups = append(groups, g)
		}
	}
	d.Groups = groups
	for _, c := range d.Connections {
		if c.GroupID == id {
			return appmessage.New("backend:groupStillContainsConnections", "分组仍有连接")
		}
	}
	return a.store.Replace(d)
}

func (a *AppService) MoveConnectionsToGroup(ids []string, groupID string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if len(ids) == 0 || len(ids) > 256 {
		return appmessage.New("backend:selectFrom1To256ConnectionsPerBatch", "每批需选择 1 至 256 个连接")
	}
	if err := a.openStorage(); err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	if groupID != "" {
		found := false
		for _, g := range d.Groups {
			if g.ID == groupID {
				found = true
				break
			}
		}
		if !found {
			return appmessage.New("backend:destinationGroupDoesNotExist", "目标分组不存在")
		}
	}
	indexes := make(map[string]int, len(d.Connections))
	for i, c := range d.Connections {
		indexes[c.ID] = i
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		i, ok := indexes[id]
		if !ok || seen[id] {
			return appmessage.New("backend:connectionMissingOrSelectedMoreThanOnce", "连接不存在或选择重复")
		}
		seen[id] = true
		d.Connections[i].GroupID = groupID
	}
	return a.store.Replace(d)
}

func (a *AppService) MoveGroup(id, parentID, beforeID string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	index := -1
	parentFound := parentID == ""
	for i, g := range d.Groups {
		if g.ID == id {
			index = i
		}
		if g.ID == parentID {
			parentFound = true
		}
	}
	if index < 0 || !parentFound {
		return appmessage.New("backend:groupOrDestinationParentGroupDoesNotExist", "分组或目标父分组不存在")
	}
	if id == beforeID {
		return appmessage.New("backend:cannotMoveAGroupBeforeItself", "不能将分组移动到自身之前")
	}
	siblings := []int{}
	for i, g := range d.Groups {
		if i != index && g.ParentID == parentID {
			siblings = append(siblings, i)
		}
	}
	sort.SliceStable(siblings, func(i, j int) bool { return d.Groups[siblings[i]].SortOrder < d.Groups[siblings[j]].SortOrder })
	position := len(siblings)
	if beforeID != "" {
		position = -1
		for i, sibling := range siblings {
			if d.Groups[sibling].ID == beforeID {
				position = i
				break
			}
		}
		if position < 0 {
			return appmessage.New("backend:orderingDestinationIsInvalidOrBelongsToA", "排序目标已失效或不属于目标父分组")
		}
	}
	siblings = append(siblings, 0)
	copy(siblings[position+1:], siblings[position:])
	siblings[position] = index
	d.Groups[index].ParentID = parentID
	for order, i := range siblings {
		d.Groups[i].SortOrder = order
	}
	return a.store.Replace(d)
}
