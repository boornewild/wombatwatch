it('runs tests with IndexedDB available', () => {
  expect(typeof indexedDB.open).toBe('function');
});
