import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import React, { lazy, Suspense } from 'react';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { LanguageProvider } from './components/LanguageContext';
import { PermissionMatrixProvider } from './hooks/usePermissionMatrix';
import AppLayout from './components/layout/AppLayout';

// ─── Public (auth) pages — โหลดทันที ───
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';

// ─── Eager load: landing + most used ───
import MyDay from './pages/MyDay';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Notifications from './pages/Notifications';

// ─── Lazy load: everything else ───
const Schedule = lazy(() => import('./pages/Schedule'));
const Customers = lazy(() => import('./pages/Customers'));
const TaskTemplates = lazy(() => import('./pages/TaskTemplates'));
const PeakAccount = lazy(() => import('./pages/PeakAccount'));
const Billing = lazy(() => import('./pages/Billing'));
const LineChat = lazy(() => import('./pages/LineChat'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const RoleManagement = lazy(() => import('./pages/RoleManagement'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const AppSettings = lazy(() => import('./pages/AppSettings'));
const DatabaseBackup = lazy(() => import('./pages/DatabaseBackup'));
const ServiceMaster = lazy(() => import('./pages/ServiceMaster'));
const HolidayMaster = lazy(() => import('./pages/HolidayMaster'));
const TeamAnalytics = lazy(() => import('./pages/TeamAnalytics'));
const StaffDashboard = lazy(() => import('./pages/StaffDashboard'));
const TaskCalendar = lazy(() => import('./pages/TaskCalendar'));
const LineFiles = lazy(() => import('./pages/LineFiles'));
const ReferralCommission = lazy(() => import('./pages/ReferralCommission'));
const TaskGeneration = lazy(() => import('./pages/TaskGeneration'));
const TimeTracking = lazy(() => import('./pages/TimeTracking'));
const WorkloadBalancer = lazy(() => import('./pages/WorkloadBalancer'));
const CustomerProfile = lazy(() => import('./pages/CustomerProfile'));
const StaffCostReport = lazy(() => import('./pages/StaffCostReport'));
const KpiDashboard = lazy(() => import('./pages/KpiDashboard'));
const ForecastRisk = lazy(() => import('./pages/ForecastRisk'));
const CustomerHealthScore = lazy(() => import('./pages/CustomerHealthScore'));
const CustomerCredentials = lazy(() => import('./pages/CustomerCredentials'));
const ExternalServiceMaster = lazy(() => import('./pages/ExternalServiceMaster'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const KnowledgeManage = lazy(() => import('./pages/KnowledgeManage'));
const EngagementInsights = lazy(() => import('./pages/EngagementInsights'));
const DirectorVault = lazy(() => import('./pages/DirectorVault'));
const ObligationDashboard = lazy(() => import('./pages/ObligationDashboard'));
const TaxCalendar = lazy(() => import('./pages/TaxCalendar'));
const CustomerMonthlySummary = lazy(() => import('./pages/CustomerMonthlySummary'));
const MySkills = lazy(() => import('./pages/MySkills'));
const MeetingNotes = lazy(() => import('./pages/MeetingNotes'));
const FindingsDashboard = lazy(() => import('./pages/FindingsDashboard'));
const MyIdeas = lazy(() => import('./pages/MyIdeas'));
const StaffScorecardPage = lazy(() => import('./pages/StaffScorecard'));
const TeamRanking = lazy(() => import('./pages/TeamRanking'));
const ReworkAnalytics = lazy(() => import('./pages/ReworkAnalytics'));
const PostponeAnalytics = lazy(() => import('./pages/PostponeAnalytics'));
const OvertimeAnalytics = lazy(() => import('./pages/OvertimeAnalytics'));
const ExecutiveBI = lazy(() => import('./pages/ExecutiveBI'));
const LineRequests = lazy(() => import('./pages/LineRequests'));
const RequestTriage = lazy(() => import('./pages/RequestTriage'));
const KeywordManager = lazy(() => import('./pages/KeywordManager'));
const UnclassifiedReview = lazy(() => import('./pages/UnclassifiedReview'));
const RequestSLABoard = lazy(() => import('./pages/RequestSLABoard'));
const FilingTracker = lazy(() => import('./pages/FilingTracker'));
const OpsHealth = lazy(() => import('./pages/OpsHealth'));
import KpiReportCenter from './pages/KpiReportCenter';
import PerformanceEvaluation from './pages/PerformanceEvaluation';


const PageLoader = () => (
  <div className="flex items-center justify-center py-20">
    <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
  </div>
);

const FullLoader = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-background">
    <div className="text-center">
      <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto"></div>
      <p className="mt-4 text-sm text-muted-foreground">กำลังโหลด ACC Consulting...</p>
    </div>
  </div>
);

// ─── ส่วนที่ต้องล็อกอินก่อน ───
const ProtectedApp = () => {
  const { isLoadingAuth, isAuthenticated, authError } = useAuth();

  if (isLoadingAuth) return <FullLoader />;

  if (!isAuthenticated) {
    if (authError?.type === 'user_not_registered') return <UserNotRegisteredError />;
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Navigate to="/MyDay" replace />} />
        <Route element={<AppLayout />}>
          {/* Eager loaded */}
          <Route path="/MyDay" element={<MyDay />} />
          <Route path="/Dashboard" element={<Dashboard />} />
          <Route path="/Tasks" element={<Tasks />} />
          <Route path="/Notifications" element={<Notifications />} />

          {/* Lazy loaded */}
          <Route path="/Schedule" element={<Schedule />} />
          <Route path="/Customers" element={<Customers />} />
          <Route path="/TaskTemplates" element={<TaskTemplates />} />
          <Route path="/PeakAccount" element={<PeakAccount />} />
          <Route path="/Billing" element={<Billing />} />
          <Route path="/LineChat" element={<LineChat />} />
          <Route path="/UserManagement" element={<UserManagement />} />
          <Route path="/RoleManagement" element={<RoleManagement />} />
          <Route path="/AuditLog" element={<AuditLog />} />
          <Route path="/AppSettings" element={<AppSettings />} />
          <Route path="/ServiceMaster" element={<ServiceMaster />} />
          <Route path="/HolidayMaster" element={<HolidayMaster />} />
          <Route path="/TeamAnalytics" element={<TeamAnalytics />} />
          <Route path="/StaffDashboard" element={<StaffDashboard />} />
          <Route path="/TaskCalendar" element={<TaskCalendar />} />
          <Route path="/DatabaseBackup" element={<DatabaseBackup />} />
          <Route path="/LineFiles" element={<LineFiles />} />
          <Route path="/ReferralCommission" element={<ReferralCommission />} />
          <Route path="/TaskGeneration" element={<TaskGeneration />} />
          <Route path="/TimeTracking" element={<TimeTracking />} />
          <Route path="/WorkloadBalancer" element={<WorkloadBalancer />} />
          <Route path="/CustomerProfile" element={<CustomerProfile />} />
          <Route path="/StaffCostReport" element={<StaffCostReport />} />
          <Route path="/KpiDashboard" element={<KpiDashboard />} />
          <Route path="/ForecastRisk" element={<ForecastRisk />} />
          <Route path="/CustomerHealthScore" element={<CustomerHealthScore />} />
          <Route path="/CustomerCredentials" element={<CustomerCredentials />} />
          <Route path="/ExternalServiceMaster" element={<ExternalServiceMaster />} />
          <Route path="/KnowledgeBase" element={<KnowledgeBase />} />
          <Route path="/KnowledgeManage" element={<KnowledgeManage />} />
          <Route path="/EngagementInsights" element={<EngagementInsights />} />
          <Route path="/DirectorVault" element={<DirectorVault />} />
          <Route path="/ObligationDashboard" element={<ObligationDashboard />} />
          <Route path="/TaxCalendar" element={<TaxCalendar />} />
          <Route path="/CustomerMonthlySummary" element={<CustomerMonthlySummary />} />
          <Route path="/MySkills" element={<MySkills />} />
          <Route path="/MeetingNotes" element={<MeetingNotes />} />
          <Route path="/FindingsDashboard" element={<FindingsDashboard />} />
          <Route path="/MyIdeas" element={<MyIdeas />} />
          <Route path="/StaffScorecard" element={<StaffScorecardPage />} />
          <Route path="/TeamRanking" element={<TeamRanking />} />
          <Route path="/ReworkAnalytics" element={<ReworkAnalytics />} />
          <Route path="/PostponeAnalytics" element={<PostponeAnalytics />} />
          <Route path="/OvertimeAnalytics" element={<OvertimeAnalytics />} />
          <Route path="/ExecutiveBI" element={<ExecutiveBI />} />
          <Route path="/KpiReportCenter" element={<KpiReportCenter />} />
          <Route path="/PerformanceEvaluation" element={<PerformanceEvaluation />} />

          {/* LINE request-triage (เพิ่มรอบสอง) */}
          <Route path="/LineRequests" element={<LineRequests />} />
          <Route path="/RequestTriage" element={<RequestTriage />} />
          <Route path="/KeywordManager" element={<KeywordManager />} />
          <Route path="/UnclassifiedReview" element={<UnclassifiedReview />} />
          <Route path="/RequestSLA" element={<RequestSLABoard />} />
          <Route path="/FilingTracker" element={<FilingTracker />} />
          <Route path="/OpsHealth" element={<OpsHealth />} />
        </Route>
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </Suspense>
  );
};

const AppRoutes = () => (
  <Routes>
    {/* หน้าเข้าถึงได้โดยไม่ต้องล็อกอิน */}
    <Route path="/login" element={<Login />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    {/* ที่เหลือทั้งหมดต้องล็อกอิน */}
    <Route path="/*" element={<ProtectedApp />} />
  </Routes>
);

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <AuthProvider>
        <LanguageProvider>
          <PermissionMatrixProvider>
            <Router>
              <AppRoutes />
            </Router>
          </PermissionMatrixProvider>
          <Toaster />
          <SonnerToaster position="bottom-right" duration={3000} closeButton richColors />
        </LanguageProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
