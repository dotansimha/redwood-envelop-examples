import { DocumentNode, ObjectTypeDefinitionNode, parse, visit } from "graphql";

/**
 * This example shows how to validate existence of directives GraphQL schema DocumentNode.
 * It throws an error if there is a field under Query/Mutation that doesn't have a directive.
 * This is done statically, and can happen during built-time, instead of checking during runtime.
 */

const testSchema = parse(`
  directive @auth on FIELD_DEFINITION
  directive @noAuth on FIELD_DEFINITION

  type Query {
    noAuthError: String
    version: String @noAuth
    me: User! @auth
    test: String
  }
  
  type User {
    id: ID!
    name: String
  }
`);

function validateDirectives(
  schemaDocumentNode: DocumentNode,
  directivesToEnforce: string[],
  typesToCheck: string[]
): string[] {
  const result: string[] = [];

  visit(schemaDocumentNode, {
    ObjectTypeDefinition(typeNode) {
      if (typesToCheck.includes(typeNode.name.value)) {
        for (const field of typeNode.fields ||
          ([] as ObjectTypeDefinitionNode[])) {
          const hasDirective = field.directives?.some((directive) =>
            directivesToEnforce.includes(directive.name.value)
          );
          if (!hasDirective) {
            result.push(`${typeNode.name.value}.${field.name.value}`);
          }
        }
      }
    },
  });

  return result;
}

const invalidFields = validateDirectives(
  testSchema,
  ["noAuth", "auth"],
  ["Query", "Mutation"]
);

for (const f of invalidFields) {
  console.info(`GraphQL field "${f}" doesn't have the required direcrives!`);
}
