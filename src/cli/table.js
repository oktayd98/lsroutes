'use strict';

const HEADER = ['Method', 'Path', 'Handler', 'Source'];
const METHOD_COLORS = { GET: 32, POST: 33, PUT: 34, PATCH: 34, DELETE: 31 }; // green, yellow, blue, blue, red
const OTHER_METHOD_COLOR = 35; // magenta
const BOLD = 1;
const DIM = 2;
const ITALIC = 3;
const MAGENTA = 35;
const CYAN = 36;

/**
 * The routes as a box-drawn table, groups separated by a divider, followed by the route count.
 *
 * @param {string[][][]} groups rows of [method, path, handler, location]
 * @param {{ color: boolean }} options
 * @returns {string}
 */
function renderTable(groups, { color }) {
  const paint = (code, text) => (color && text ? `\x1b[${code}m${text}\x1b[0m` : text);
  const columnColors = [
    (method) => paint(`${BOLD};${METHOD_COLORS[method.trim()] || OTHER_METHOD_COLOR}`, method),
    // unresolved placeholders {like.this} in magenta, parameters :id and wildcards in cyan
    (routePath) => routePath.replace(/\{[^}]*\}/g, (m) => paint(MAGENTA, m)).replace(/:\w+|\*/g, (m) => paint(CYAN, m)),
    (handler) => (handler.trim() === 'function' ? paint(ITALIC, handler) : handler),
    (location) => paint(DIM, location),
  ];

  const rows = groups.flat();
  const widths = HEADER.map((_, i) => Math.max(...[HEADER, ...rows].map((row) => row[i].length)));
  const line = (left, middle, right) => paint(DIM, left + widths.map((width) => '─'.repeat(width + 2)).join(middle) + right);
  const bar = paint(DIM, '│');
  // pad before coloring: escape codes would break the width math
  const row = (cells, colorCell) => bar + cells.map((cell, i) => ` ${colorCell(cell.padEnd(widths[i]), i)} `).join(bar) + bar;

  const lines = [line('┌', '┬', '┐'), row(HEADER, (cell) => paint(BOLD, cell)), line('├', '┼', '┤')];
  groups.forEach((group, i) => {
    if (i) lines.push(line('├', '┼', '┤'));
    for (const cells of group) lines.push(row(cells, (cell, column) => columnColors[column](cell)));
  });
  lines.push(line('└', '┴', '┘'));
  lines.push(paint(DIM, `${rows.length} route${rows.length === 1 ? '' : 's'}`));
  return lines.join('\n') + '\n';
}

module.exports = { renderTable };
