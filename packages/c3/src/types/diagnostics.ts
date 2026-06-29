export type DiagnosticStatus = 'pass' | 'warning' | 'fail' | 'pending';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  message: string;

  count?: number;
  adapter?: string;
  source?: string;
  durationMs?: number;
  details?: string[];
}

export interface DiagnosticsReport {
  mode: 'mock' | 'sharepoint';
  siteUrl: string;
  generatedAt: string;
  overallStatus: DiagnosticStatus;
  checks: DiagnosticCheck[];
}