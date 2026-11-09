package app

import (
	"context"
	"encoding/json"

	"io"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/files"
	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

type CommandCheck struct {
	Kind     string `json:"kind"`
	Source   string `json:"source,omitempty"`
	Expected string `json:"expected,omitempty"`
	Pointer  string `json:"pointer,omitempty"`
	Operator string `json:"operator,omitempty"`
	FilePath string `json:"file_path,omitempty"`
}

type InspectionCheckResult struct {
	State    string `json:"state"`
	Message  string `json:"message"`
	Actual   string `json:"actual,omitempty"`
	Expected string `json:"expected,omitempty"`
}

type InspectionBaseline struct {
	Workspace string `json:"workspace"`
	Path      string `json:"path"`
	Revision  string `json:"revision"`
}

type CommandStepResult struct {
	Command *terminal.CommandResult `json:"command,omitempty"`
	Check   *InspectionCheckResult  `json:"check,omitempty"`
}

func (a *AppService) ValidateCommandSteps(steps []CommandStep) error {
	if len(steps) == 0 || len(steps) > 16 {
		return appmessage.New("backend:provideFrom1To16Steps", "步骤须为 1 至 16 项")
	}
	for _, step := range steps {
		if err := validateCommandStep(step); err != nil {
			return err
		}
	}
	return nil
}

func validateCommandStep(step CommandStep) error {
	if strings.TrimSpace(step.Name) == "" || len(step.Name) > 128 || len(step.Script) > 32<<10 || strings.ContainsRune(step.Script, 0) || step.TimeoutSeconds < 1 || step.TimeoutSeconds > 600 {
		return appmessage.New("backend:stepsRequireANameACommandWithin32", "步骤须包含名称、最多 32 KiB 的命令及 1 至 600 秒超时")
	}
	if step.Check == nil || step.Check.Kind != "file" {
		if strings.TrimSpace(step.Script) == "" {
			return appmessage.New("backend:commandStepsCannotBeEmpty", "命令步骤不能为空")
		}
	} else if step.Script != "" {
		return appmessage.New("backend:fileBaselineComparisonStepsCannotAlsoContainA", "文件基线比较步骤不能同时包含命令")
	}
	if step.Check == nil {
		return nil
	}
	c := step.Check
	if len(c.Expected) > 4096 || len(c.Pointer) > 1024 || (c.Source != "" && c.Source != "stdout" && c.Source != "stderr") {
		return appmessage.New("backend:invalidExpectedValueJSONPointerOrOutputChannel", "判定值、JSON Pointer 或输出通道无效")
	}
	switch c.Kind {
	case "exit":
		code, err := strconv.Atoi(c.Expected)
		if err != nil || code < 0 || code > 255 {
			return appmessage.New("backend:expectedExitCodeMustBeFrom0To", "预期退出码须为 0 至 255")
		}
	case "text":
		if c.Expected == "" {
			return appmessage.New("backend:expectedTextCannotBeEmpty", "预期文本不能为空")
		}
	case "regex":
		if c.Expected == "" {
			return appmessage.New("backend:regularExpressionCannotBeEmpty", "正则表达式不能为空")
		}
		if _, err := regexp.Compile(c.Expected); err != nil {
			return appmessage.Errorf("backend:invalidCheckRegularExpression", "判定正则无效：%w", err)
		}
	case "json":
		if c.Pointer != "" && (!strings.HasPrefix(c.Pointer, "/") || regexp.MustCompile(`~([^01]|$)`).MatchString(c.Pointer)) {
			return appmessage.New("backend:jSONPointerMustBeEmptyOrStartWith", "JSON Pointer 须为空或以 / 开头，使用 ~0 与 ~1 转义")
		}
		expected, err := decodeInspectionJSON(c.Expected)
		if err != nil {
			return appmessage.Errorf("backend:invalidExpectedJSONValue", "预期 JSON 值无效：%w", err)
		}
		switch expected.(type) {
		case nil, bool, string, json.Number:
		default:
			return appmessage.New("backend:expectedJSONValueMustBeAStringNumber", "预期 JSON 值须为字符串、数字、布尔值或 null")
		}
		if number, ok := expected.(json.Number); ok {
			if _, err := inspectionNumber(number); err != nil {
				return err
			}
		}
		switch c.Operator {
		case "", "eq", "ne":
		case "gt", "gte", "lt", "lte":
			if _, ok := expected.(json.Number); !ok {
				return appmessage.New("backend:orderingComparisonsRequireJSONNumbers", "大小比较需要 JSON 数字")
			}
		default:
			return appmessage.New("backend:invalidJSONComparisonOperator", "JSON 比较方式无效")
		}
	case "file":
		return validateRemotePaths([]string{c.FilePath})
	default:
		return appmessage.New("backend:invalidInspectionCheckType", "巡检判定类型无效")
	}
	return nil
}

func decodeInspectionJSON(value string) (any, error) {
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.UseNumber()
	var result any
	if err := decoder.Decode(&result); err != nil {
		return nil, err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, appmessage.New("backend:multipleJSONValuesOrTrailingContent", "包含多份 JSON 或额外内容")
	}
	return result, nil
}

func inspectionJSONValue(root any, pointer string) (any, error) {
	if pointer == "" {
		return root, nil
	}
	for _, part := range strings.Split(pointer[1:], "/") {
		part = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
		switch value := root.(type) {
		case map[string]any:
			var ok bool
			root, ok = value[part]
			if !ok {
				return nil, appmessage.New("backend:jSONFieldDoesNotExist", "JSON 字段不存在")
			}
		case []any:
			index, err := strconv.Atoi(part)
			if err != nil || strconv.Itoa(index) != part || index < 0 || index >= len(value) {
				return nil, appmessage.New("backend:jSONArrayIndexDoesNotExist", "JSON 数组索引不存在")
			}
			root = value[index]
		default:
			return nil, appmessage.New("backend:jSONPathCrossesAValueThatIsNot", "JSON 路径经过非对象或数组")
		}
	}
	return root, nil
}

func inspectionNumber(value json.Number) (*big.Rat, error) {
	text := string(value)
	if len(text) > 128 {
		return nil, appmessage.New("backend:jSONNumberExceeds128Characters", "JSON 数字超过 128 字符")
	}
	if index := strings.IndexAny(text, "eE"); index >= 0 {
		exponent, err := strconv.Atoi(text[index+1:])
		if err != nil || exponent < -4096 || exponent > 4096 {
			return nil, appmessage.New("backend:jSONExponentExceedsComparisonRange", "JSON 数字指数超出比较范围")
		}
	}
	number, ok := new(big.Rat).SetString(text)
	if !ok {
		return nil, appmessage.New("backend:jSONNumberCannotBeCompared", "JSON 数字无法比较")
	}
	return number, nil
}

func evaluateCommandCheck(check CommandCheck, command terminal.CommandResult) InspectionCheckResult {
	result := InspectionCheckResult{State: "unknown", Expected: check.Expected}
	if command.Error != "" {
		result.Message = command.Error
		return result
	}
	passed := false
	if check.Kind == "exit" {
		result.Actual = strconv.Itoa(command.ExitCode)
		wanted, _ := strconv.Atoi(check.Expected)
		passed = command.ExitCode == wanted
	} else {
		if command.Truncated {
			result.Message = "输出已截断，无法完整判定"
			return result
		}
		if command.ExitCode != 0 {
			result.Message = "采集命令非零退出，无法判定内容"
			return result
		}
		output := command.Stdout
		if check.Source == "stderr" {
			output = command.Stderr
		}
		switch check.Kind {
		case "text":
			passed = strings.Contains(output, check.Expected)
		case "regex":
			expression, err := regexp.Compile(check.Expected)
			if err != nil {
				result.Message = err.Error()
				return result
			}
			passed = expression.MatchString(output)
		case "json":
			root, err := decodeInspectionJSON(output)
			if err != nil {
				result.Message = "输出不是完整有效的 JSON"
				return result
			}
			actual, err := inspectionJSONValue(root, check.Pointer)
			if err != nil {
				result.Message = err.Error()
				return result
			}
			expected, err := decodeInspectionJSON(check.Expected)
			if err != nil {
				result.Message = err.Error()
				return result
			}
			encoded, _ := json.Marshal(actual)
			if len(encoded) > 4096 {
				result.Message = "JSON 字段超过展示上限"
				return result
			}
			result.Actual = string(encoded)
			if number, ok := actual.(json.Number); ok {
				wanted, ok := expected.(json.Number)
				if !ok {
					result.Message = "JSON 字段与预期类型不同"
					return result
				}
				left, leftError := inspectionNumber(number)
				right, rightError := inspectionNumber(wanted)
				if leftError != nil || rightError != nil {
					result.Message = "JSON 数字超出比较范围"
					return result
				}
				comparison := left.Cmp(right)
				switch check.Operator {
				case "gt":
					passed = comparison > 0
				case "gte":
					passed = comparison >= 0
				case "lt":
					passed = comparison < 0
				case "lte":
					passed = comparison <= 0
				case "ne":
					passed = comparison != 0
				default:
					passed = comparison == 0
				}
			} else {
				switch actual.(type) {
				case nil, bool, string:
				default:
					result.Message = "JSON 字段不是标量"
					return result
				}
				if check.Operator != "" && check.Operator != "eq" && check.Operator != "ne" {
					result.Message = "JSON 字段不是数字"
					return result
				}
				passed = actual == expected
				if check.Operator == "ne" {
					passed = !passed
				}
			}
		}
	}
	result.State, result.Message = "fail", "不符合预期"
	if passed {
		result.State, result.Message = "pass", "符合预期"
	}
	return result
}

func (a *AppService) PrepareInspectionBaseline(ctx context.Context, workspace, remote string, timeoutSeconds int) (InspectionBaseline, error) {
	step := CommandStep{Name: "基线", TimeoutSeconds: timeoutSeconds, Check: &CommandCheck{Kind: "file", FilePath: remote}}
	if err := validateCommandStep(step); err != nil {
		return InspectionBaseline{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds)*time.Second)
	defer cancel()
	doc, err := a.ReadRemoteFileEncoded(ctx, workspace, remote, "UTF-8")
	if err != nil {
		return InspectionBaseline{}, err
	}
	return InspectionBaseline{Workspace: workspace, Path: remote, Revision: doc.Revision}, nil
}

func (a *AppService) RunCommandStep(ctx context.Context, workspace string, step CommandStep, baseline *InspectionBaseline) (CommandStepResult, error) {
	if err := validateCommandStep(step); err != nil {
		return CommandStepResult{}, err
	}
	if step.Check == nil || step.Check.Kind != "file" {
		command, err := a.RunRemoteCommand(ctx, workspace, step.Script, step.TimeoutSeconds)
		if err != nil {
			return CommandStepResult{}, err
		}
		result := CommandStepResult{Command: &command}
		if step.Check != nil {
			check := evaluateCommandCheck(*step.Check, command)
			result.Check = &check
		}
		return result, nil
	}
	if baseline == nil || baseline.Workspace == "" || baseline.Path != step.Check.FilePath || baseline.Revision == "" {
		return CommandStepResult{}, appmessage.New("backend:selectABaselineHostAndPrepareTheCurrent", "请先选择基线主机并准备当前文件版本")
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(step.TimeoutSeconds)*time.Second)
	defer cancel()
	read := func(id string) (files.Document, error) {
		return a.ReadRemoteFileEncoded(ctx, id, baseline.Path, "UTF-8")
	}
	reference, err := read(baseline.Workspace)
	if err != nil {
		return CommandStepResult{}, appmessage.Errorf("backend:couldNotReadBaseline", "读取基线失败：%w", err)
	}
	if reference.Revision != baseline.Revision {
		return CommandStepResult{}, appmessage.New("backend:baselineFileChangedStartTheInspectionAgain", "基线文件已变化，请重新开始巡检")
	}
	current := reference
	if workspace != baseline.Workspace {
		current, err = read(workspace)
		if err != nil {
			return CommandStepResult{}, err
		}
	}
	check := InspectionCheckResult{State: "fail", Message: "与基线内容不同", Expected: "与基线一致"}
	if current.Content == reference.Content && current.BOM == reference.BOM {
		check.State, check.Message = "pass", "与基线内容一致"
	}
	return CommandStepResult{Check: &check}, nil
}
