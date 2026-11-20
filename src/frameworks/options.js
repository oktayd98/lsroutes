'use strict';
// Reading options objects passed to framework calls: `register(plugin, { prefix })`, `@Controller({ path })`.
const { keyName } = require('../analysis/ast');

/** Path of the value of `key` in the first of the object literal values that has it (a method counts as its value). */
function optionPath(objects, key) {
  for (const object of objects) {
    const property = object.literal.get('properties')
      .find((p) => (p.isObjectProperty() || p.isObjectMethod()) && keyName(p.node) === key);
    if (property) return property.isObjectMethod() ? property : property.get('value');
  }
  return null;
}

/** Strings an option can be ('GET', ['GET', 'HEAD'], a constant), a placeholder when unknown, null when absent. */
function stringOption(resolver, objects, key) {
  const option = optionPath(objects, key);
  if (!option) return null;
  return resolver.routePaths(option) || [resolver.placeholder(option)];
}

module.exports = { optionPath, stringOption };
