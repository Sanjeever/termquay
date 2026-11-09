// Package message carries stable diagnostic metadata across application boundaries.
// It has no language state or translation dependencies.
package message

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

type Descriptor struct {
	Message     string         `json:"message"`
	MessageCode string         `json:"messageCode,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
	Causes      []*Descriptor  `json:"causes,omitempty"`
}

type Error struct {
	code       string
	parameters map[string]any
	cause      error
}

func New(code, diagnostic string) error {
	return &Error{code: code, cause: errors.New(diagnostic)}
}

func Errorf(code, format string, arguments ...any) error {
	parameters := make(map[string]any, len(arguments))
	for index, argument := range arguments {
		if err, ok := argument.(error); ok {
			argument = Describe(err)
		} else {
			argument = fmt.Sprint(argument)
		}
		parameters[fmt.Sprintf("value%d", index+1)] = argument
	}
	return &Error{code: code, parameters: parameters, cause: fmt.Errorf(format, arguments...)}
}

func (e *Error) Error() string                        { return e.cause.Error() }
func (e *Error) Unwrap() error                        { return e.cause }
func (e *Error) DiagnosticCode() string               { return e.code }
func (e *Error) DiagnosticParameters() map[string]any { return e.parameters }

func Describe(err error) *Descriptor {
	if err == nil {
		return nil
	}
	result := &Descriptor{Message: err.Error()}
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		for _, cause := range joined.Unwrap() {
			result.Causes = append(result.Causes, Describe(cause))
		}
		return result
	}
	var coded interface{ DiagnosticCode() string }
	if errors.As(err, &coded) {
		result.MessageCode = coded.DiagnosticCode()
		if parameters, ok := coded.(interface{ DiagnosticParameters() map[string]any }); ok {
			result.Parameters = parameters.DiagnosticParameters()
		}
	} else {
		if errors.Is(err, context.Canceled) {
			result.MessageCode = "backend:operationCanceled"
		}
		if errors.Is(err, context.DeadlineExceeded) {
			result.MessageCode = "backend:operationTimedOut"
		}
	}
	return result
}

func Join(values ...*Descriptor) *Descriptor {
	result := &Descriptor{}
	var diagnostics []string
	for _, value := range values {
		if value != nil && value.Message != "" {
			result.Causes = append(result.Causes, value)
			diagnostics = append(diagnostics, value.Message)
		}
	}
	result.Message = strings.Join(diagnostics, "\n")
	return result
}
