/**
 * TypeScript interfaces for resultapp.org
 * Covers school onboarding, student credits, subscriptions, and result compilation.
 */

// School onboarding & profile
export interface School {
  id: string;
  name: string;
  slug: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string; // default "NG"
  logoUrl?: string;
  heroBgUrl?: string;
  motto?: string;
  proprietorName?: string;
  registrationNumber?: string;
  idPrefix?: string;
  newTermBegins?: string;
  createdAt: string; // ISO date
  updatedAt: string;
  isVerified: boolean;
  isActive: boolean;
  subscription?: Subscription;
  credits?: StudentCredits;
}

export interface SchoolRegistrationPayload {
  schoolName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  address?: string;
  city?: string;
  state: string;
  proprietorName: string;
  numberOfStudentsEstimate?: number;
  planId?: string;
  acceptTerms: boolean;
}

export interface SchoolOnboardingStep {
  id: number;
  title: string;
  description: string;
  completed: boolean;
}

// Student & academic
export interface Student {
  id: string;
  schoolId: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  classLevel: string; // e.g. "JSS1", "SS3"
  classArm?: string; // e.g. "A", "Gold"
  gender?: "male" | "female" | "other";
  dateOfBirth?: string;
  parentEmail?: string;
  parentPhone?: string;
  photoUrl?: string;
  isActive: boolean;
  createdAt: string;
}

export interface StudentUploadPayload {
  file: File;
  classLevel: string;
  session: string; // e.g. "2025/2026"
  term: "first" | "second" | "third";
}

export interface ClassInfo {
  id: string;
  name: string; // e.g. "JSS1"
  arm?: string;
  classTeacherId?: string;
  studentCount: number;
}

// Credits & billing (pay-per-student model)
export interface StudentCredits {
  balance: number; // number of student result slots remaining
  totalPurchased: number;
  totalUsed: number;
  lastTopUpAt?: string;
}

export interface CreditPurchase {
  id: string;
  schoolId: string;
  quantity: number; // number of students
  unitPrice: number;
  totalAmount: number;
  currency: string;
  txRef: string;
  flwRef?: string;
  status: "pending" | "successful" | "failed" | "abandoned";
  paymentMethod?: string;
  createdAt: string;
  verifiedAt?: string;
}

export interface PricingPlan {
  id: string;
  name: string; // e.g. "Starter", "Growth", "Enterprise"
  description: string;
  pricePerStudent: number;
  currency: string;
  minStudents: number;
  maxStudents?: number;
  features: string[];
  isPopular?: boolean;
  ctaText?: string;
}

// Subscription (if using recurring rather than one-off credits)
export interface Subscription {
  id: string;
  schoolId: string;
  planId: string;
  planName: string;
  status: "active" | "past_due" | "cancelled" | "trialing" | "inactive" | "unpaid" | "trial";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

// Results compilation
export interface Subject {
  id: string;
  name: string;
  code: string; // e.g. "MTH"
  category?: "core" | "elective";
}

export interface ResultEntry {
  studentId: string;
  subjectId: string;
  ca1?: number;
  ca2?: number;
  exam?: number;
  total: number;
  grade: string;
  remark?: string;
  position?: number;
}

export interface TermResult {
  id: string;
  schoolId: string;
  studentId: string;
  session: string;
  term: "first" | "second" | "third";
  classLevel: string;
  results: ResultEntry[];
  totalScore: number;
  average: number;
  positionInClass?: number;
  totalInClass?: number;
  remark?: string;
  publishedAt?: string;
  isPublished: boolean;
}

// Auth & session
export interface AuthUser {
  id: string;
  email: string;
  role: "admin" | "principal" | "teacher" | "super_admin";
  schoolId?: string;
  school?: School;
  token?: string;
}

export interface ApiErrorResponse {
  message: string;
  detail?: string | Record<string, string[]>;
  statusCode: number;
}
