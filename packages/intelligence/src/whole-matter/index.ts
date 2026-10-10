export type {
  AuthorityContextItem,
  AuthorityResolutionBucket,
  ClaimCentricView,
  ContradictionKind,
  ContradictionRecord,
  DefenseCentricView,
  DiscoveryChainView,
  EvidenceRelationKind,
  FactEvidenceProposition,
  InvestigateNextItem,
  MatterStatusFlag,
  MotionConvergenceView,
  SourceRef,
  WholeMatterIntelligence,
  WholeMatterStatus,
} from "./types";

export { assembleWholeMatterIntelligence, type WholeMatterAssemblyInput } from "./assemble";
export { loadWholeMatterIntelligence } from "./load";
export {
  isWholeMatterAskQuestion,
  answerWholeMatterQuestion,
  formatWholeMatterAnswer,
  buildWholeMatterAskContextBlock,
  type WholeMatterAskAnswer,
} from "./ask";
export { runPass7WholeMatterFixture } from "./fixtures";
export {
  planWholeMatterGraph,
  type WholeMatterGraphNode,
  type WholeMatterGraphEdge,
} from "./graph";
