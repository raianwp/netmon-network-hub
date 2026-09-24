export * from "./generated/api";
export * from "./generated/types";
// `testHostAgent` mixes a path param with query params, so orval names both
// the zod object (generated/api) and the plain TS type (generated/types)
// identically, which `export *` can't disambiguate on its own. The zod
// object is the one actually used for request validation — re-export it
// explicitly so it wins over the colliding type-only name.
export { TestHostAgentParams } from "./generated/api";
