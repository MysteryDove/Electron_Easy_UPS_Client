import { Input, type InputProps } from '@headlessui/react';

type BaseInputProps = Omit<InputProps<'input'>, 'as'>;

export type UiInputProps = BaseInputProps;

export function UiInput(props: UiInputProps) {
  return <Input as="input" {...props} />;
}
