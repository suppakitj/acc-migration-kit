import React, { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const DEFAULT_MATRIX = {
  login:          { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  // ─── ฟีเจอร์ใหม่ (ภายในสำหรับพนักงาน) ───
  request_sla:    { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  filing_tracker: { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  ops_health:     { admin: 'yes', management: 'yes', manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  user_master:    { admin: 'yes', management: 'no',  manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  role_mgmt:      { admin: 'yes', management: 'no',  manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  customer:       { admin: 'yes', management: 'yes', manager: 'no',  super_supervisor: 'yes', staff: 'edit_only' },
  template:       { admin: 'yes', management: 'yes', manager: 'dept',super_supervisor: 'dept',staff: 'no' },
  view_task:      { admin: 'yes', management: 'yes', manager: 'dept',super_supervisor: 'dept',staff: 'dept' },
  edit_assignee:  { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'no' },
  change_due:     { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'own' },
  change_status:  { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'own' },
  add_task:       { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  view_billing:   { admin: 'yes', management: 'yes', manager: 'dept',super_supervisor: 'dept',staff: 'no' },
  view_schedule:  { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'dept',staff: 'dept' },
  add_schedule:   { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  edit_schedule:  { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'own' },
  cross_group:    { admin: 'yes', management: 'no',  manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  peak:           { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'no',  staff: 'no' },
  service_master: { admin: 'yes', management: 'yes', manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  holiday_master: { admin: 'yes', management: 'yes', manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  staff_dashboard:{ admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'no',  staff: 'no' },
  task_calendar:  { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  team_analytics: { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'no',  staff: 'no' },
  reports:        { admin: 'yes', management: 'no',  manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  audit_log:      { admin: 'yes', management: 'no',  manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  db_backup:      { admin: 'yes', management: 'no',  manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  ocr:            { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  referral:       { admin: 'yes', management: 'yes', manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  task_generation:{ admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'no' },
  time_tracking:  { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  workload:       { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'no',  staff: 'no' },
  customer_profile:{ admin: 'yes', management: 'yes', manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  staff_cost_report:{ admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'no',  staff: 'no' },
  kpi_dashboard:    { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'no' },
  forecast_risk:    { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'no' },
  customer_health:  { admin: 'yes', management: 'yes', manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  credential_vault: { admin: 'yes', management: 'yes', manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  external_service: { admin: 'yes', management: 'yes', manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  knowledge_base:   { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  knowledge_manage: { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  my_day:           { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  my_skills:        { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  announcement_manage: { admin: 'yes', management: 'yes', manager: 'no', super_supervisor: 'no', staff: 'no' },
  shoutout:         { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  engagement_insights: { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'no', staff: 'no' },
  director_vault:     { admin: 'yes', management: 'yes', manager: 'no',  super_supervisor: 'no',  staff: 'no' },
  obligation_dashboard: { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'no',  staff: 'no' },
  tax_calendar:        { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  customer_summary:    { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'no',  staff: 'no' },
  meeting_notes: { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  findings_dashboard: { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  my_ideas: { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  staff_scorecard: { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  rework_analytics:{ admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'no' },
  team_ranking:    { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'no' },
  postpone_analytics:{ admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'no' },
  executive_bi:            { admin: 'yes', management: 'yes', manager: 'no', super_supervisor: 'no', staff: 'no' },
  kpi_report_center:       { admin: 'yes', management: 'yes', manager: 'no', super_supervisor: 'no', staff: 'no' },
  performance_evaluation:  { admin: 'yes', management: 'yes', manager: 'no', super_supervisor: 'no', staff: 'no' },
  overtime_analytics:      { admin: 'yes', management: 'yes', manager: 'no', super_supervisor: 'no', staff: 'no' },
  line_requests:    { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'no' },
  request_triage:   { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'no' },
  taxqa_intake:     { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'yes' },
  taxqa_review:     { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'no' },
  taxqa_dashboard:  { admin: 'yes', management: 'yes', manager: 'yes', super_supervisor: 'yes', staff: 'no' },
  taxqa_config:     { admin: 'yes', management: 'yes', manager: 'no',  super_supervisor: 'no',  staff: 'no' },
};

const PermissionMatrixContext = createContext(DEFAULT_MATRIX);

export function PermissionMatrixProvider({ children }) {
  const { data: configs = [] } = useQuery({
    queryKey: ['appConfig', 'permission_matrix'],
    queryFn: () => base44.entities.AppConfig.filter({ key: 'permission_matrix' }),
    staleTime: 60000,
  });

  const savedOverrides = (() => {
    const cfg = configs.find(c => c.key === 'permission_matrix');
    if (cfg?.value) {
      try { return JSON.parse(cfg.value); } catch { return {}; }
    }
    return {};
  })();

  // Merge saved overrides into default
  const matrix = {};
  for (const [key, defaults] of Object.entries(DEFAULT_MATRIX)) {
    matrix[key] = { ...defaults, ...(savedOverrides[key] || {}) };
  }

  return React.createElement(PermissionMatrixContext.Provider, { value: matrix }, children);
}

export function usePermissionMatrix() {
  return useContext(PermissionMatrixContext);
}

/**
 * Get the permission value for a capability+role from a matrix object.
 */
export function getPerm(matrix, capability, role) {
  return matrix?.[capability]?.[role] || 'no';
}