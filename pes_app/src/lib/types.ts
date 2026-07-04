export type Role = 'student' | 'dept_admin'

export interface Student {
  id: string
  reg_number: string | null
  index_number: string | null
  name: string
  email: string
  department: string
  batch_year: number | null
  role: Role
  status: 'active' | 'withdrawn' | 'transferred' | 'graduated'
  created_at: string
  avatar_url?: string | null
}

export interface Course {
  id: string
  course_code: string
  title: string
  credits: number
  semester: number
  year: number
  department: string
  category: 'Compulsory' | 'Elective' | 'Optional'
  minor_category: string | null
  contributes_to_gpa: boolean
}

export interface Enrollment {
  id: string
  student_id: string
  course_id: string
  academic_year: string
  status: 'enrolled' | 'dropped' | 'completed'
  enrolled_at: string
}

export interface Attendance {
  id: string
  student_id: string
  course_id: string
  lecture_date: string
  status: 'present' | 'absent' | 'excused'
  recorded_at: string
}

export interface Result {
  id: string
  student_id: string
  course_id: string
  academic_year: string
  mid_sem_mark: number | null
  ca_mark: number | null
  ese_mark: number | null
  oa_mark: number | null
  grade: string | null
  gpv: number | null
  is_published: boolean
}

export interface Lecturer {
  id: string
  name: string
  email: string
  department: string
}

export interface Feedback {
  id: string
  student_id: string | null
  course_id: string
  lecturer_id: string
  rating: number
  comment: string
  is_anonymous: boolean
  submitted_at: string
}

export interface MedicalSubmission {
  id: string
  student_id: string
  course_id: string
  missed_date: string
  submitted_at: string
  file_url: string | null
  status: 'pending' | 'approved' | 'rejected'
  deadline: string
}