import { Button, type ButtonProps } from '@headlessui/react';

type BaseButtonProps = Omit<ButtonProps<'button'>, 'as'>;

export type UiButtonProps = BaseButtonProps;

export function UiButton(props: UiButtonProps) {
  return <Button as="button" {...props} />;
}
