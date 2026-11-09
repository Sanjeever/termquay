package message

import (
	"context"
	"errors"
	"testing"
)

func TestDiagnosticMetadataPreservesErrorChain(t *testing.T) {
	inner := New("backend:inner", "original diagnostic")
	err := Errorf("backend:outer", "operation %s: %w", "path", inner)
	if !errors.Is(err, inner) || err.Error() != "operation path: original diagnostic" {
		t.Fatalf("lost diagnostic or identity: %v", err)
	}
	detail := Describe(err)
	nested, ok := detail.Parameters["value2"].(*Descriptor)
	if detail.MessageCode != "backend:outer" || detail.Parameters["value1"] != "path" || !ok || nested.MessageCode != "backend:inner" {
		t.Fatalf("lost structured context: %+v", detail)
	}
	canceled := Errorf("backend:cancel", "operation: %w", context.Canceled)
	if !errors.Is(canceled, context.Canceled) {
		t.Fatal("cancellation identity lost")
	}
	if Describe(nil) != nil || Describe(context.Canceled).Message != context.Canceled.Error() {
		t.Fatal("unknown diagnostics changed")
	}
}
