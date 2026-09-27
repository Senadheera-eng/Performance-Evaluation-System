/**
 * Shared presentation layer for both the student and admin portals.
 *
 * Pages import from here rather than hand-rolling cards, headers and states,
 * which is what kept the two portals looking like different products.
 */
export { StatusBadge, gradeTone, type StatusTone } from "./StatusBadge";
export { CourseCode, DepartmentBadge, DepartmentDot } from "./DepartmentBadge";
export { DepartmentSelect } from "./DepartmentSelect";
export { PersonAvatar, initialsOf } from "./PersonAvatar";
export {
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonStatGrid,
  SkeletonRows,
} from "./States";
export {
  PageHeader,
  SectionCard,
  StatCard,
  ActionCard,
} from "./Surfaces";
export { ChartContainer, ChartTooltip } from "./ChartContainer";
export { GpaTrendChart, type GpaTrendPoint } from "./GpaTrendChart";
export {
  CourseAttendanceChart,
  type CourseAttendancePoint,
} from "./CourseAttendanceChart";
export { SegmentedTabs, type SegmentedTabItem } from "./SegmentedTabs";
export { ProgressRing } from "./ProgressRing";
export {
  DURATION,
  EASE,
  usePageMotion,
  useListMotion,
  useHoverLift,
  useChartMotion,
} from "./motion";
