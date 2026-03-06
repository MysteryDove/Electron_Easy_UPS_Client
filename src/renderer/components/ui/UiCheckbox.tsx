import { Input, type InputProps } from '@headlessui/react';

type BaseCheckboxProps = Omit<InputProps<'input'>, 'as' | 'type'>;

export type UiCheckboxProps = BaseCheckboxProps;

export function UiCheckbox(props: UiCheckboxProps) {
  return <Input as="input" type="checkbox" {...props} />;
}
