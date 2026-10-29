/**
 * Shared presentation layer for both the student and admin portals.
 *
 * Pages import from here rather than hand-rolling cards, headers and states,
 * which is what kept the two portals looking like different products.
 */
export { StatusBadge, gradeTone, type StatusTone } from "./StatusBadge";
export {
  CodedText,
  CourseCode,
  DepartmentBadge,
  DepartmentDot,
  DepartmentName,
} from "./DepartmentBadge";
export { DepartmentSelect } from "./DepartmentSelect";
export { DepartmentChips } from "./DepartmentChips";
export { CourseSelect, type CourseSelectOption } from "./CourseSelect";
export { PersonAvatar, initialsOf } from "./PersonAvatar";
export {
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonHero,
  SkeletonStatGrid,
  SkeletonRows,
} from "./States";
export {
  PageHeader,
  HeroCard,
  StatStrip,
  SectionCard,
  StatCard,
  ActionCard,
  Reveal,
  heroButtonClass,
  heroGhostButtonClass,
  type StripItem,
} from "./Surfaces";
export { AnimatedNumber, AnimatedBar } from "./Animated";
export {
  Toolbar,
  SearchField,
  FilterButton,
  ActiveFilters,
  type ActiveFilter,
} from "./Toolbar";
export { DataTable, type DataColumn } from "./DataTable";
export { StickyActionBar } from "./StickyActionBar";
export { ChartContainer, ChartTooltip } from "./ChartContainer";
export { GpaTrendChart, type GpaTrendPoint } from "./GpaTrendChart";
export {
  CourseAttendanceChart,
  type CourseAttendancePoint,
} from "./CourseAttendanceChart";
export {
  SegmentedTabs,
  PillTabs,
  TabPanel,
  type SegmentedTabItem,
} from "./SegmentedTabs";
export { ProgressRing } from "./ProgressRing";
export {
  DURATION,
  EASE,
  SPRING,
  pageEnter,
  stagger,
  cardReveal,
  listItem,
  sectionExpand,
  tabContent,
  usePageMotion,
  useListMotion,
  useHoverLift,
  useChartMotion,
  useExpandMotion,
} from "./motion";
