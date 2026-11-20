'use strict';
// Rules: what `value.name` is, for each kind of value that has members.
const { Kind, Value } = require('./values');
const { keyName, propertyName } = require('./ast');

/** Values of `value.name` for each of `values`. */
function memberOf(resolver, values, name) {
  return values.flatMap((value) => {
    const rule = RULES[value.kind];
    return rule ? rule(resolver, value, name) : [];
  });
}

const RULES = {
  [Kind.FRAMEWORK]: (resolver, value, name) => resolver.frameworks.of(value).member(resolver, value, name),
  [Kind.MODULE]: (resolver, module, name) => resolver.exportOf(module.file, name),
  [Kind.INSTANCE]: (resolver, instance, name) => instanceMember(resolver, instance.classDeclaration, name),
  [Kind.OBJECT]: objectProperty,
};

function objectProperty(resolver, object, name) {
  const property = object.literal.get('properties')
    .find((p) => (p.isObjectProperty() || p.isObjectMethod()) && keyName(p.node) === name);
  if (!property) return [];
  return property.isObjectMethod() ? [Value.function(property)] : resolver.resolve(property.get('value'));
}

/**
 * `instance.name` for an instance of a class: a class field or method, a TypeScript parameter property,
 * or a `this.name = ...` assignment anywhere in the class; falls back to the superclass.
 */
function instanceMember(resolver, cls, name) {
  const key = `${cls.node.start}:${resolver.project.fileOf(cls).filePath}#${name}`;
  return resolver.guard(key, () => {
    const values = [];
    for (const member of cls.get('body.body')) {
      const isInstanceMember = (member.isClassProperty() || member.isClassMethod()) && !member.node.static;
      if (isInstanceMember && keyName(member.node) === name) {
        values.push(...(member.isClassMethod() ? [Value.function(member)] : resolver.resolve(member.get('value'))));
      }
      if (member.isClassMethod({ kind: 'constructor' })) {
        member.node.params.forEach((param, i) => {
          if (param.type === 'TSParameterProperty' && param.parameter.name === name) values.push(...resolver.parameterValues(member, i));
        });
      }
    }
    cls.traverse({
      AssignmentExpression(assignment) {
        const target = assignment.get('left');
        const isThisMember = target.isMemberExpression() && target.get('object').isThisExpression() && propertyName(target) === name;
        if (isThisMember) values.push(...resolver.resolve(assignment.get('right')));
      },
    });
    if (!values.length && cls.node.superClass) {
      const superclasses = resolver.resolve(cls.get('superClass')).filter((value) => value.kind === Kind.CLASS);
      values.push(...memberOf(resolver, superclasses.map((superclass) => Value.instance(superclass.declaration)), name));
    }
    return values;
  });
}

module.exports = { memberOf };
