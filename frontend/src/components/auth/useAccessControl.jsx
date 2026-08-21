import { useMemo } from 'react';
import { usePermissionMatrix, getPerm } from '@/hooks/usePermissionMatrix';

export function useAccessControl(user) {
  const matrix = usePermissionMatrix();

  return useMemo(() => {
    if (!user) return empty();

    const role = user.role || user.data?.role || 'staff';
    const email = user.email || '';

    const depts = user.departments?.length
      ? user.departments
      : user.department ? [user.department] : [];

    // Helper: get perm value from matrix
    const p = (cap) => getPerm(matrix, cap, role);

    // ─── page-level access ───────────────────────────────────
    const canManageUsers         = p('user_master') === 'yes';
    const canManageRoles         = p('role_mgmt') === 'yes';
    const customerPerm           = p('customer');
    const canManageCustomers     = customerPerm !== 'no' && customerPerm !== 'view_only';
    const canAddCustomer         = customerPerm === 'yes' || customerPerm === 'dept';
    const canDeleteCustomer      = customerPerm === 'yes';
    const canEditCustomer        = customerPerm !== 'no' && customerPerm !== 'view_only'; // edit_only, yes, dept all can edit
    const canViewCustomer        = customerPerm !== 'no'; // view_only can still view
    const canManageTemplates     = p('template') === 'yes';
    const canManageTemplatesDept = p('template') === 'dept';
    const canViewBilling         = p('view_billing') === 'yes' || p('view_billing') === 'view_only';
    const canViewBillingDept     = p('view_billing') === 'dept';
    const canEditBilling         = p('view_billing') !== 'no' && p('view_billing') !== 'view_only';
    const canViewPeakAccount     = p('peak') !== 'no';
    const canEditPeakAccount     = p('peak') !== 'no' && p('peak') !== 'view_only';
    const canManageServiceMaster = p('service_master') !== 'no' && p('service_master') !== 'view_only';
    const canViewServiceMaster   = p('service_master') !== 'no';
    const canManageHolidays      = p('holiday_master') !== 'no' && p('holiday_master') !== 'view_only';
    const canViewHolidays        = p('holiday_master') !== 'no';
    const crossGroup             = p('cross_group') === 'yes';
    const canViewStaffDashboard  = p('staff_dashboard') !== 'no';
    const canViewTeamAnalytics   = p('team_analytics') !== 'no';
    const canViewReports         = p('reports') !== 'no';
    const canViewAuditLog        = p('audit_log') !== 'no';
    const canViewDbBackup        = p('db_backup') !== 'no';

    // ─── task-level permissions ──────────────────────────────
    const canEditAssignee = p('edit_assignee') !== 'no';
    const canAddTask      = p('add_task') !== 'no';

    /**
     * canChangeDueDate — returns 'direct' | 'request' | false
     * - 'direct': can change due date directly (not own task, or admin)
     * - 'request': must request approval (own task for super_supervisor/manager/management)
     * - false: no permission at all
     */
    const canChangeDueDate = (task) => {
      const v = p('change_due');
      if (v === 'no') return false;

      const isOwn = task?.assigned_to === email || task?.created_by === email;

      // Admin can always change directly
      if (role === 'admin') return 'direct';

      // For roles that have 'yes' or 'dept' permission
      if (v === 'yes' || v === 'dept') {
        // If it's their own task → must request approval from higher role
        if (isOwn) return 'request';
        // Not own task → can change directly
        return 'direct';
      }

      // Staff with 'own' → must request approval
      if (v === 'own') {
        if (isOwn) return 'request';
        return false;
      }

      return false;
    };

    const canChangeStatus = (task) => {
      const v = p('change_status');
      if (v === 'yes' || v === 'dept') return true;
      if (v === 'own') return task?.assigned_to === email || task?.created_by === email;
      return false;
    };

    // ─── data filtering ──────────────────────────────────────
    const filterByDepartment = (records, deptField = 'department') => {
      // Admin always sees all data
      if (role === 'admin' || crossGroup || p('view_task') === 'yes') return records;
      return records.filter(r => {
        const rd = r[deptField];
        if (!rd) return true;
        return depts.includes(rd);
      });
    };

    const canAccessDepartment = (dept) => {
      // Admin always has access to all departments
      if (role === 'admin' || crossGroup || p('view_task') === 'yes') return true;
      if (!dept) return true;
      return depts.includes(dept);
    };

    // ─── schedule permissions ─────────────────────────────────
    const canViewAllSchedules = p('view_schedule') === 'yes';
    const canAddSchedule = p('add_schedule') !== 'no';

    const canEditSchedule = (schedule) => {
      const v = p('edit_schedule');
      if (v === 'yes' || v === 'dept') return true;
      if (v === 'own') return schedule?.assigned_to === email || schedule?.created_by === email;
      return false;
    };

    // ─── sidebar menu visibility ─────────────────────────────
    const getVisibleMenuIds = () => {
      const menus = ['dashboard', 'settings'];

      if (p('view_task') !== 'no')       menus.push('tasks');
      if (p('task_calendar') !== 'no')   menus.push('task_calendar');
      if (p('view_schedule') !== 'no')   menus.push('schedule');
      if (p('customer') !== 'no')        menus.push('customers');
      if (p('template') !== 'no')        menus.push('templates');
      if (p('peak') !== 'no')            menus.push('peak');
      if (p('service_master') !== 'no')  menus.push('service_master');
      if (role === 'admin') menus.push('keyword_manager');
      if (p('holiday_master') !== 'no')  menus.push('holiday_master');
      if (p('view_billing') !== 'no')    menus.push('billing');
      if (p('user_master') !== 'no')     menus.push('users');
      if (p('role_mgmt') !== 'no')       menus.push('roles');

      // line_chat & line_files → always visible
      menus.push('line_chat');
      menus.push('line_files');
      if (p('line_requests') !== 'no') menus.push('line_requests');
      if (p('request_triage') !== 'no') menus.push('request_triage');
      if (p('request_triage') !== 'no') menus.push('unclassified_review');
      if (p('request_sla') !== 'no') menus.push('request_sla');
      if (p('filing_tracker') !== 'no') menus.push('filing_tracker');
      if (p('ops_health') !== 'no') menus.push('ops_health');
      if (p('referral') !== 'no')    menus.push('referral');

      // All menu visibility now from matrix
      if (p('staff_dashboard') !== 'no') menus.push('staff_dashboard');
      if (p('team_analytics') !== 'no')  menus.push('team_analytics');
      if (p('reports') !== 'no')         menus.push('reports');
      if (p('audit_log') !== 'no')       menus.push('audit');
      if (p('db_backup') !== 'no')       menus.push('backup');


      // Task Generation
      if (p('task_generation') !== 'no') menus.push('task_generation');

      // Time Tracking
      if (p('time_tracking') !== 'no') menus.push('time_tracking');

      // Workload Balancer
      if (p('workload') !== 'no') menus.push('workload');

      // Customer Profile
      if (p('customer_profile') !== 'no') menus.push('customer_profile');

      // Staff Cost Report
      if (p('staff_cost_report') !== 'no') menus.push('staff_cost_report');

      // KPI Dashboard
      if (p('kpi_dashboard') !== 'no') menus.push('kpi_dashboard');

      // Forecast & Risk
      if (p('forecast_risk') !== 'no') menus.push('forecast_risk');

      // Customer Health
      if (p('customer_health') !== 'no') menus.push('customer_health');

      // Credential Vault
      if (p('credential_vault') !== 'no') menus.push('credential_vault');

      // External Service Master
      if (p('external_service') !== 'no') menus.push('external_service');

      // Knowledge Base
      if (p('knowledge_base') !== 'no') menus.push('knowledge_base');
      if (p('knowledge_manage') !== 'no') menus.push('knowledge_manage');

      // Engagement Insights
      if (p('engagement_insights') !== 'no') menus.push('engagement_insights');

      // Director Vault
      if (p('director_vault') !== 'no') menus.push('director_vault');

      // Obligation Dashboard
      if (p('obligation_dashboard') !== 'no') menus.push('obligation_dashboard');

      // Tax Calendar
      if (p('tax_calendar') !== 'no') menus.push('tax_calendar');

      // Customer Summary
      if (p('customer_summary') !== 'no') menus.push('customer_summary');

      // My Day
      if (p('my_day') !== 'no') menus.push('my_day');
      if (p('my_skills') !== 'no') menus.push('my_skills');
      if (p('meeting_notes') !== 'no') menus.push('meeting_notes');
      if (p('findings_dashboard') !== 'no') menus.push('findings_dashboard');
      if (p('my_ideas') !== 'no') menus.push('my_ideas');
      if (p('staff_scorecard') !== 'no') menus.push('staff_scorecard');
      if (p('team_ranking') !== 'no') menus.push('team_ranking');
      if (p('rework_analytics') !== 'no') menus.push('rework_analytics');
      if (p('postpone_analytics') !== 'no') menus.push('postpone_analytics');

      // Executive tier
      if (p('executive_bi') !== 'no')           menus.push('executive_bi');
      if (p('kpi_report_center') !== 'no')      menus.push('kpi_report_center');
      if (p('performance_evaluation') !== 'no') menus.push('performance_evaluation');

      // Overtime Analytics
      if (p('overtime_analytics') !== 'no') menus.push('overtime_analytics');

      // Tax QA
      if (p('taxqa_intake') !== 'no') menus.push('taxqa_intake');
      if (p('taxqa_review') !== 'no') menus.push('taxqa_review');
      if (p('taxqa_dashboard') !== 'no') menus.push('taxqa_dashboard');
      if (p('taxqa_config') !== 'no') menus.push('taxqa_config');

      return menus;
    };

    return {
      role, email, userDepartments: depts,
      canManageUsers, canManageRoles, canManageCustomers,
      canAddCustomer, canDeleteCustomer, canEditCustomer, canViewCustomer,
      canManageTemplates, canManageTemplatesDept,
      canManageServiceMaster, canViewServiceMaster,
      canManageHolidays, canViewHolidays,
      canViewBilling, canViewBillingDept, canEditBilling,
      canViewPeakAccount, canEditPeakAccount,
      canViewAllSchedules, canAddSchedule, canEditSchedule,
      canEditAssignee, canAddTask, canChangeDueDate, canChangeStatus,
      filterByDepartment, canAccessDepartment,
      getVisibleMenuIds,
      canSeeAll: role === 'admin' || crossGroup,
      canViewReferral: p('referral') !== 'no',
      canEditReferral: p('referral') !== 'no' && p('referral') !== 'view_only',
      canManageAnnouncements: p('announcement_manage') !== 'no' && p('announcement_manage') !== 'view_only',
      canViewStaffDashboard, canViewTeamAnalytics, canViewReports, canViewAuditLog, canViewDbBackup,
      canViewEngagementInsights: p('engagement_insights') !== 'no',
      canViewDirectorVault: p('director_vault') !== 'no',
      canViewObligationDashboard: p('obligation_dashboard') !== 'no',
    canViewCustomerSummary: p('customer_summary') !== 'no',
    canViewFindingsDashboard: p('findings_dashboard') !== 'no',
    };
  }, [user, matrix]);
}

function empty() {
  return {
    role: '', email: '', userDepartments: [],
    canManageUsers: false, canManageRoles: false, canManageCustomers: false,
    canAddCustomer: false, canDeleteCustomer: false, canEditCustomer: false, canViewCustomer: false,
    canManageTemplates: false, canManageTemplatesDept: false,
    canManageServiceMaster: false, canViewServiceMaster: false,
    canManageHolidays: false, canViewHolidays: false,
    canViewBilling: false, canViewBillingDept: false, canEditBilling: false,
    canViewPeakAccount: false, canEditPeakAccount: false,
    canViewAllSchedules: false, canAddSchedule: false, canEditSchedule: () => false,
    canEditAssignee: false, canAddTask: false,
    canChangeDueDate: () => false, canChangeStatus: () => false,
    filterByDepartment: () => [], canAccessDepartment: () => false,
    getVisibleMenuIds: () => ['dashboard', 'notifications', 'settings'],
    canSeeAll: false,
    canViewReferral: false, canEditReferral: false, canManageAnnouncements: false,
    canViewStaffDashboard: false, canViewTeamAnalytics: false, canViewReports: false, canViewAuditLog: false, canViewDbBackup: false,
    canViewEngagementInsights: false,
    canViewDirectorVault: false,
    canViewObligationDashboard: false,
    canViewCustomerSummary: false,
    canViewFindingsDashboard: false,
  };
}