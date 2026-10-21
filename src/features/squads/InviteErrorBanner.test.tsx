import { render, screen, fireEvent } from '@testing-library/react';
import { InviteErrorBanner, inviteErrorMessage } from './InviteErrorBanner';

it('explains each refusal from join_squad_by_invite in plain words', () => {
  expect(inviteErrorMessage('expired')).toMatch(/invite link has expired/);
  expect(inviteErrorMessage('max_uses_reached')).toMatch(/already been used/);
  expect(inviteErrorMessage('invalid_token')).toMatch(/invalid or has been revoked/);
  expect(inviteErrorMessage('something_new')).toMatch(/couldn't use this invite link/);
});

it('banner shows the message and can be dismissed', () => {
  const onDismiss = vi.fn();
  render(<InviteErrorBanner code="expired" onDismiss={onDismiss} />);
  expect(screen.getByRole('status')).toHaveTextContent(/invite link has expired/);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onDismiss).toHaveBeenCalled();
});
