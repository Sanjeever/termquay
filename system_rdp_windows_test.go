package main

import (
	"encoding/binary"
	"encoding/hex"
	"testing"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestSystemRDPPasswordDPAPIRoundTrip(t *testing.T) {
	const password = "仅供测试-test-🔐"
	protected, err := protectRDPPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := hex.DecodeString(protected)
	if err != nil {
		t.Fatal(err)
	}
	input := windows.DataBlob{Size: uint32(len(raw)), Data: &raw[0]}
	var output windows.DataBlob
	if err = windows.CryptUnprotectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output); err != nil {
		t.Fatal(err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(output.Data)))
	plain := unsafe.Slice(output.Data, output.Size)
	units := make([]uint16, len(plain)/2)
	for index := range units {
		units[index] = binary.LittleEndian.Uint16(plain[index*2:])
	}
	if string(utf16.Decode(units)) != password {
		t.Fatal("系统 RDP 密码解密不一致")
	}
	clear(plain)
	clear(units)
}
