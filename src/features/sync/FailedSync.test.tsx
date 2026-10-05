import { render, screen, fireEvent } from '@testing-library/react';
import { FailedSyncChip, FailedSyncList, type FailedItem } from './FailedSync';

const theme = { ink: '#000', mid: '#333', soft: '#eee', div: '#ddd', f700: '#060', rose700: '#a00', amb50: '#fe9', amb700: '#a60' };
const items: FailedItem[] = [
  { qid: 1, kind: 'Treatment', name: 'Seed Wombat', action: 'save', error: 'permission denied (42501)' },
  { qid: 3, kind: 'Burrow', name: 'Creek Burrow', action: 'delete', error: 'x' },
];

it('chip shows the count and opens the list', () => {
  const onOpen = vi.fn();
  render(<FailedSyncChip count={2} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: /2 couldn't sync/ }));
  expect(onOpen).toHaveBeenCalled();
});

it('chip renders nothing when there is nothing parked', () => {
  const { container } = render(<FailedSyncChip count={0} onOpen={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

it('list shows each record with its error, and Retry / Discard act on that record', () => {
  const onRetry = vi.fn();
  const onDiscard = vi.fn();
  render(<FailedSyncList items={items} theme={theme} onRetry={onRetry} onDiscard={onDiscard} />);
  expect(screen.getByText('Treatment · Seed Wombat')).toBeInTheDocument();
  expect(screen.getByText('permission denied (42501)')).toBeInTheDocument();
  expect(screen.getByText('Burrow · Creek Burrow (delete)')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[1]!);
  fireEvent.click(screen.getAllByRole('button', { name: 'Discard' })[0]!);
  expect(onRetry).toHaveBeenCalledWith(3);
  expect(onDiscard).toHaveBeenCalledWith(items[0]);
});

it('list explains when everything has synced', () => {
  render(<FailedSyncList items={[]} theme={theme} onRetry={() => {}} onDiscard={() => {}} />);
  expect(screen.getByText(/Everything has synced/)).toBeInTheDocument();
});
