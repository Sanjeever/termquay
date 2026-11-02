import { heroui } from '@heroui/react';
export default heroui({ themes: { light: { colors: {
  background: '#f8f9fc', foreground: '#202633', divider: '#cbd2de',
  content1: '#eef1f6', content2: '#e5eaf2', content3: '#dce2ec', content4: '#cbd2de',
  primary: { DEFAULT: '#3456bc', foreground: '#ffffff' },
  default: { 50: '#f8f9fc', 100: '#eef1f6', 200: '#dce2ec', 300: '#cbd2de', 400: '#8995a7', 500: '#667286', 600: '#566175', 700: '#414d61', 800: '#303c50', 900: '#202633', DEFAULT: '#dce2ec', foreground: '#202633' },
  danger: { DEFAULT: '#a52131', foreground: '#ffffff' }, success: '#22613f', warning: '#795400', focus: '#3456bc',
} }, dark: { colors: {
  background: '#101216', foreground: '#e6e9ef', divider: '#2c3039',
  content1: '#20232a', content2: '#272b34', content3: '#2c3039', content4: '#343b48',
  primary: { DEFAULT: '#8ba7ff', foreground: '#101216' },
  default: { 50: '#17191e', 100: '#20232a', 200: '#2c3039', 300: '#424958', 400: '#788295', 500: '#9aa3b2', 600: '#b7becc', 700: '#d0d5df', 800: '#e6e9ef', 900: '#f8f9fb', DEFAULT: '#2c3039', foreground: '#e6e9ef' },
  danger: { DEFAULT: '#ffaaaa', foreground: '#301919' }, success: '#8ed6b2', warning: '#e8c484', focus: '#8ba7ff',
} } }, layout: { radius: { small: '6px', medium: '6px', large: '10px' }, disabledOpacity: '0.45' } });
