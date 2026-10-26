// Демонстрационные данные: настоящие названия и картинки, количества выдуманы.
(function () {
  const layout = [
    [[8], 0], [[], 1], [[5, 4], 3], [[], 1], [[12], 0], [[3], 2], [[], 1], [[], 1],
    [[7], 0], [[], 2], [[], 1], [[4], 1], [[], 1], [[], 1], [[9], 0], [[], 1],
    [[2], 0], [[], 1], [[6], 0], [[], 1], [[], 1], [[3], 0], [[], 1], [[], 1],
    [[10], 0], [[], 1], [[2], 1], [[], 1], [[], 1], [[5], 0], [[], 1], [[], 1],
    [[], 1], [[4], 0], [[], 1], [[], 1], [[3], 0], [[], 1], [[], 1], [[2], 0]
  ];
  window.GROUPS = window.ITEMS.map((it, i) => {
    const [stacks, singles] = layout[i % layout.length];
    const total = stacks.reduce((a, b) => a + b, 0) + singles;
    return { ...it, stacks, singles, total, affected: stacks.length > 0 };
  });
  const g = window.GROUPS;
  window.TOTALS = {
    items: g.reduce((a, x) => a + x.total, 0),
    records: g.reduce((a, x) => a + x.stacks.length + x.singles, 0),
    stacks: g.reduce((a, x) => a + x.stacks.length, 0),
    requests: g.reduce((a, x) => a + x.stacks.reduce((s, n) => s + n - 1, 0), 0)
  };
})();
