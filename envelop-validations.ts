import {
  DirectiveDefinitionNode,
  ExecutionArgs,
  getDirectiveValues,
  parse as gqlParse,
} from "graphql";
import { envelop, Plugin, useSchema } from "@envelop/core";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { DirectiveNode, GraphQLObjectType, GraphQLResolveInfo } from "graphql";
import { PromiseOrValue } from "graphql/jsutils/PromiseOrValue";

export function getDirective(
  info: GraphQLResolveInfo,
  name: string
): null | DirectiveNode {
  const { parentType, fieldName, schema } = info;
  const schemaType = schema.getType(parentType.name) as GraphQLObjectType;
  const field = schemaType.getFields()[fieldName];
  const astNode = field.astNode;
  const directive = astNode?.directives?.find((d) => d.name.value === name);

  return directive || null;
}

type ResolverPayload = {
  root: any;
  args: Record<string, any>;
  context: any;
  info: GraphQLResolveInfo;
};

/**
 * My suggestion here is to use 2 differnet signatures for validation and transformation, and then call each one based on it's existence.
 */
export type RedwoodDirective<DirectiveArgs = {}> = {
  schema: string;
  /**
   * Createing a validation directive will allow you to validate the arguments of the resolver.
   * And actually access everything else that you needs.
   * This function should probably only throw an exception if the validation fails.
   */
  validation?: (
    args: ExecutionArgs,
    directiveArgs: DirectiveArgs,
    resolverParams: ResolverPayload
  ) => PromiseOrValue<void>;
  /**
   * This function will be called with the result of the resolver, and allow you to return a transformed value.
   */
  transformation?: (
    args: ExecutionArgs,
    directiveArgs: DirectiveArgs,
    resolverParams: ResolverPayload,
    result: any
  ) => PromiseOrValue<void>;
};

export const requiresAuthDirective: RedwoodDirective<{
  role: "ADMIN" | "USER";
}> = {
  schema: /* GraphQL */ `
    enum Role {
      USER
      ADMIN
    }

    directive @auth(role: Role!) on FIELD_DEFINITION
  `,
  validation: (args, directiveArgs) => {
    if (!args.contextValue.currentUser) {
      throw new Error("Oops, go away!");
    } else if (
      args.contextValue.correntUser &&
      args.contextValue.correntUser.role !== directiveArgs.role
    ) {
      throw new Error(
        `You don't have the required role '${directiveArgs.role}' for this field!`
      );
    }
  },
};

export const uppercaseDirective: RedwoodDirective = {
  schema: /* GraphQL */ `
    directive @uppercase on FIELD_DEFINITION
  `,
  transformation: (args, directiveArgs, resolverParams, result) => {
    if (result && typeof result === "string") {
      return result.toUpperCase();
    }

    return result;
  },
};

const testSchema = makeExecutableSchema({
  typeDefs: /* GraphQL */ `
    ${requiresAuthDirective.schema}
    ${uppercaseDirective.schema}

    type Query {
      me: User! @auth(role: USER)
      simple: String
      secretPassword: String @auth(role: ADMIN)
      testUpper: String @uppercase
    }

    type User {
      id: ID!
      name: String!
    }
  `,
  resolvers: {
    Query: {
      simple: () => "Hi",
      secretPassword: () => "123456",
      testUpper: () => "dotan",
      me: (root, args, context) => context.currentUser,
    },
  },
});

const useRedwoodDirectives = <T>(
  redwoodDirective: RedwoodDirective<T>
): Plugin => {
  const directiveName = (
    gqlParse(redwoodDirective.schema).definitions.find(
      (v) => v.kind === "DirectiveDefinition"
    ) as DirectiveDefinitionNode
  ).name.value;

  console.log(directiveName);

  return {
    onExecute({ args: executionArgs }) {
      return {
        async onResolverCalled({ args, context, info, root }) {
          const directiveNode = getDirective(info, directiveName);

          if (directiveNode) {
            const directive = executionArgs.schema.getDirective(
              directiveNode?.name.value
            );

            if (directive) {
              const directiveArgs =
                getDirectiveValues(
                  directive,
                  { directives: [directiveNode] },
                  executionArgs.variableValues
                ) || ({} as any);

              if (redwoodDirective.validation) {
                await redwoodDirective.validation(
                  executionArgs,
                  directiveArgs,
                  { root, args, context, info }
                );
              }

              // Note: this can't be async!
              // It's called after the resolver is done, so you can manipulate stuff.
              return ({ result, setResult }) => {
                if (redwoodDirective.transformation) {
                  const modifiedValue = redwoodDirective.transformation(
                    executionArgs,
                    directiveArgs,
                    { root, args, context, info },
                    result
                  );

                  setResult(modifiedValue);
                }
              };
            }
          }
        },
      };
    },
  };
};

async function test() {
  const getEnveloped = envelop({
    plugins: [
      useSchema(testSchema),
      useRedwoodDirectives(requiresAuthDirective),
      useRedwoodDirectives(uppercaseDirective),
    ],
  });

  const { execute, schema, parse } = getEnveloped({});

  console.log(
    "This one runs with a simple USER, and is authenticated, so it works fine:",
    await execute({
      document: parse(/* GraphQL */ `
        query {
          me {
            id
          }
        }
      `),
      schema,
      contextValue: {
        currentUser: {
          id: "1",
          name: "Dotan",
          role: "USER",
        },
      },
    })
  );

  console.log(
    "This one is not authenticated, so it throws an error",
    await execute({
      document: parse(/* GraphQL */ `
        query {
          me {
            id
          }
        }
      `),
      schema,
      contextValue: {}, // missing currentUser
    })
  );

  console.log(
    "This one is just upper case transformation",
    await execute({
      document: parse(/* GraphQL */ `
        query {
          testUpper
        }
      `),
      schema,
      contextValue: {},
    })
  );
}

test();
