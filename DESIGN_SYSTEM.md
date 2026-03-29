# Performance Evaluation System (PES) - UI Framework

## Design System Overview

### Color Palette
The design system is inspired by the University of Sri Jayewardenepura's branding:

**Primary Colors:**
- Brand Red: #C41E3A (Main brand color)
- Brand Red Dark: #8B1538
- Brand Gold: #FDB913 (Accent color)
- Brand Gold Light: #FFD700

**Supporting Colors:**
- Secondary Purple: #8B5CF6 (For variety and charts)
- Success Green: #10B981
- Warning Yellow: #F59E0B
- Danger Red: #EF4444
- Info Blue: #3B82F6

**Neutral Palette:**
- Background: #F9FAFB
- Foreground: #111827
- Card: #FFFFFF
- Muted: #F3F4F6
- Border: #E5E7EB

### Typography
- Font Family: Inter (with system fallbacks)
- Font Weights: 400 (normal), 500 (medium), 600 (semibold), 700 (bold)
- Responsive scaling with CSS custom properties

### Layout Components

#### 1. Login Page (`/`)
- Split-screen modern design
- Left: Login form with university logo
- Right: Hero section with animated gradient background
- Features: Email/password, show/hide password, remember me, forgot password

#### 2. Main App Layout (`/app/*`)
- **Sidebar Navigation** (Desktop: Fixed, Mobile: Overlay)
  - Dashboard
  - Courses
  - Attendance
  - Results
  - Enrollment
  - AI Assistant (with "New" badge)
  - Profile
  - Settings
  
- **Top Header**
  - Mobile menu button
  - Search bar
  - Notifications bell (with indicator)
  - User profile dropdown

### Pages

#### Dashboard (`/app`)
- Overview stats: CGPA, Courses Enrolled, Avg. Attendance, Total Credits
- Alert cards for warnings and notifications
- Interactive charts (GPA trend, Attendance overview)
- Ongoing courses grid
- Recent results table

#### Courses (`/app/courses`)
- Search and filter functionality
- Tabs: All, Ongoing, Completed, Upcoming
- Course cards with status badges
- Progress indicators
- Attendance percentages
- Grades for completed courses

#### Attendance (`/app/attendance`)
- Overview statistics
- Critical/Good/Excellent course breakdown
- Detailed attendance cards with progress bars
- Smart warnings for courses below 80%
- Last attended date tracking

#### Results (`/app/results`)
- Current CGPA display with trend
- Credits earned progress
- GPA trend chart (bar chart)
- Performance radar chart
- Semester-wise result tables
- Grade badges with color coding

#### AI Assistant (`/app/ai-assistant`)
- Chat interface with message history
- Suggested questions sidebar
- AI capabilities showcase
- Real-time message UI (demo mode)

#### Profile (`/app/profile`)
- Student information card with avatar
- Academic information
- Achievements and awards
- Semester progress tracking
- Contact details

#### Settings (`/app/settings`)
- Account settings
- Notification preferences (with toggles)
- Appearance settings (theme selection)
- Privacy & security options

#### Enrollment (`/app/enrollment`)
- Course selection with checkboxes
- Real-time credit calculation
- Availability status indicators
- Prerequisites display
- Seat availability tracking
- Core vs Elective filtering

### Reusable Components

#### StatCard
- Icon, title, value, change indicator
- Color variants for different metrics
- Hover animations

#### CourseCard
- Status badge (Ongoing/Completed/Upcoming)
- Credits, attendance, progress
- Hover effects with elevation

#### AlertCard
- Type variants: success, warning, error, info
- Icon, title, message
- Optional action button

### Design Features

#### Animations
- Motion library for smooth transitions
- Fade-in, slide-in effects
- Hover states with elevation
- Loading and skeleton states ready

#### Responsive Design
- Mobile-first approach
- Breakpoints: sm (640px), md (768px), lg (1024px)
- Collapsible sidebar for mobile
- Responsive grids and layouts

#### Visual Effects
- Gradient backgrounds
- Glassmorphism elements
- Shadow elevation system
- Border radius consistency (0.75rem)
- Custom utility classes:
  - `.gradient-primary`
  - `.gradient-accent`
  - `.gradient-secondary`
  - `.gradient-hero`
  - `.glass` / `.glass-dark`
  - `.text-gradient`
  - `.shadow-glow`

### Scalability

The framework is designed for easy expansion:
- Consistent component patterns
- Reusable utility functions
- Modular page structure
- Centralized theme configuration
- Ready for backend integration
- Type-safe with TypeScript

### Technology Stack
- React 18.3.1
- React Router 7 (Data Mode)
- TypeScript
- Tailwind CSS v4
- Motion (Framer Motion)
- Recharts for data visualization
- Radix UI components
- Lucide React icons

### Next Steps for Backend Integration
1. Replace mock data with API calls
2. Add authentication flow
3. Connect to Supabase or backend API
4. Implement real-time updates
5. Add AI assistant integration
6. Enable actual course enrollment
7. Connect attendance tracking system
8. Integrate result publication system

---

This UI framework provides a solid foundation for building a production-ready academic performance evaluation system with modern UX patterns and scalable architecture.
