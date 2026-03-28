export type JobStatus = 'Not applied' | 'Applied' | 'Interviewing' | 'Offer' | 'Rejected'
export type Seniority = 'Director' | 'VP' | 'Head of' | 'Senior Manager'
export type CompanySize = 'startup' | 'scale-up' | 'enterprise'
export type Tab = 'product-marketing' | 'finance'

export interface Job {
  id: string
  title: string
  company: string
  url: string
  seniority: Seniority
  industry: string
  companySize: CompanySize
  location: string
  daysPosted: number
  compensation: string
  matchScore: number
  salaryMin?: number
  salaryMax?: number
  salaryIsEstimated?: boolean
  source?: 'adzuna' | 'linkedin_manual' | 'career_page'
  notes?: string
  reasoning?: string
  dateApplied?: string
}

export interface Filters {
  seniority: Seniority[]
  daysPosted: string | null
  companySize: CompanySize[]
  hideApplied: boolean
  minMatchScore: number
  euHqOnly: boolean
}
