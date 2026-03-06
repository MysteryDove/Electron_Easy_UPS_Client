import { Select, type SelectProps } from '@headlessui/react';

type BaseSelectProps = Omit<SelectProps<'select'>, 'as'>;

export type UiSelectProps = BaseSelectProps;

export function UiSelect(props: UiSelectProps) {
  return <Select as="select" {...props} />;
}
