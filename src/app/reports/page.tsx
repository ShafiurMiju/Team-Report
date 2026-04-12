'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import DashboardLayout from '@/components/DashboardLayout';
import Modal from '@/components/Modal';
import StatusBadge from '@/components/StatusBadge';
import toast from 'react-hot-toast';
import { Calendar, Copy, FileText, MessageCircle, Mail } from 'lucide-react';

interface ReportData {
  date: string;
  formattedDate: string;
  scope?: 'team' | 'me' | 'member';
  report: string;
  tasks: any[];
  grouped: Record<
    string,
    {
      project: { id: string; name: string; emoji: string };
      users: Record<
        string,
        {
          user: { id: string; name: string };
          tasks: { title: string; status: string }[];
        }
      >;
    }
  >;
}

interface MemberOption {
  id: string;
  name: string;
  role?: string;
}

export default function ReportsPage() {
  const { data: session } = useSession();
  const suggestedToEmail = 'md.emon@octopi-digital.com';
  const suggestedCcEmails = 'wahidur.rahman@octopi-digital.com, jewel.rana@octopi-digital.com, faridul.shihab@octopi-digital.com';
  const suggestedEmailOptions = [
    'md.emon@octopi-digital.com',
    'wahidur.rahman@octopi-digital.com',
    'jewel.rana@octopi-digital.com',
    'faridul.shihab@octopi-digital.com',
  ];
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailIsHtml, setEmailIsHtml] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [showToSuggestions, setShowToSuggestions] = useState(false);
  const [showCcSuggestions, setShowCcSuggestions] = useState(false);
  const [reportScope, setReportScope] = useState<'team' | 'me' | 'member'>('team');
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [leaderFilterId, setLeaderFilterId] = useState<'all' | string>('all');
  const [memberFilterId, setMemberFilterId] = useState('');
  const emailBodyEditorRef = useRef<HTMLDivElement | null>(null);
  const [filterDate, setFilterDate] = useState(
    new Date().toISOString().split('T')[0]
  );

  const isAdmin = session?.user?.role === 'admin';
  const isLeader = session?.user?.role === 'leader' || isAdmin;
  const effectiveScope: 'team' | 'me' | 'member' = isAdmin ? 'team' : (isLeader ? reportScope : 'me');
  const isTeamScope = effectiveScope === 'team';
  const leaderOptions = members.filter((member) => member.role === 'leader');
  const teamMemberOptions = members.filter((member) => member.role !== 'leader');

  const fetchReport = async () => {
    if (!isAdmin && effectiveScope === 'member' && !memberFilterId) {
      setReportData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        date: filterDate,
        scope: effectiveScope,
      });
      if (isAdmin && effectiveScope === 'team' && leaderFilterId !== 'all') {
        params.set('leaderId', leaderFilterId);
      }
      if (!isAdmin && effectiveScope === 'member' && memberFilterId) {
        params.set('userId', memberFilterId);
      }
      const res = await fetch(`/api/reports?${params.toString()}`);
      const data = await res.json();
      setReportData(data);
    } catch {
      toast.error('Failed to load report');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchReport();
  }, [filterDate, effectiveScope, leaderFilterId, memberFilterId, isAdmin]);

  useEffect(() => {
    if (!isLeader) return;

    const fetchMembers = async () => {
      try {
        const res = await fetch('/api/members');
        if (!res.ok) return;
        const data = await res.json();
        setMembers(Array.isArray(data) ? data : []);
      } catch {
        setMembers([]);
      }
    };

    fetchMembers();
  }, [isLeader]);

  useEffect(() => {
    if (isAdmin) return;
    if (effectiveScope !== 'member') return;
    if (memberFilterId) return;
    if (teamMemberOptions.length === 0) return;

    setMemberFilterId(teamMemberOptions[0].id);
  }, [isAdmin, effectiveScope, memberFilterId, teamMemberOptions]);

  const copyToClipboard = async () => {
    if (!reportData?.report) return;
    try {
      await navigator.clipboard.writeText(reportData.report);
      toast.success('Report copied to clipboard!');
    } catch {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = reportData.report;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      toast.success('Report copied to clipboard!');
    }
  };

  const shareToWhatsApp = () => {
    if (!reportData?.report) return;
    const cleanText = reportData.report.replace(/\r\n/g, '\n');
    const encoded = encodeURIComponent(cleanText);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank', 'noopener,noreferrer');
  };

  const generateAiEmail = async () => {
    setEmailLoading(true);
    try {
      const res = await fetch('/api/reports/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: filterDate,
          scope: effectiveScope,
          ...(isAdmin && effectiveScope === 'team' && leaderFilterId !== 'all'
            ? { leaderId: leaderFilterId }
            : {}),
          ...(!isAdmin && effectiveScope === 'member' && memberFilterId
            ? { userId: memberFilterId }
            : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to generate email');
      }

      setEmailSubject(data?.subject || 'Daily Task Update');
      setEmailBody((data?.htmlBody || data?.body || '') as string);
      setEmailIsHtml(Boolean(data?.isHtml));
      setEmailTo(suggestedToEmail);
      setEmailCc(suggestedCcEmails);
      setEmailModalOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate email';
      if (message.toLowerCase().includes('ai is not enabled')) {
        toast.error('AI not enabled. Please enable AI in Settings first.');
      } else {
        toast.error(message);
      }
    }
    setEmailLoading(false);
  };

  const copyEmailContent = async () => {
    const latestBody = emailIsHtml && emailBodyEditorRef.current
      ? emailBodyEditorRef.current.innerHTML
      : emailBody;

    if (emailIsHtml) {
      setEmailBody(latestBody);
    }

    const text = `Subject: ${emailSubject}\n\n${latestBody}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Email content copied');
    } catch {
      toast.error('Failed to copy email content');
    }
  };

  const sendGeneratedEmail = async () => {
    if (!emailTo.trim()) {
      toast.error('Recipient email is required');
      return;
    }

    const latestBody = emailIsHtml && emailBodyEditorRef.current
      ? emailBodyEditorRef.current.innerHTML
      : emailBody;

    if (emailIsHtml) {
      setEmailBody(latestBody);
    }

    setEmailSending(true);
    try {
      const res = await fetch('/api/reports/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailTo,
          cc: emailCc,
          subject: emailSubject,
          body: latestBody,
          isHtml: emailIsHtml,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to send email');
      }

      toast.success('Email sent successfully');
      setEmailModalOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send email');
    }
    setEmailSending(false);
  };

  const appendCcSuggestion = (email: string) => {
    const parts = emailCc
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    if (parts.includes(email)) {
      return;
    }

    setEmailCc([...parts, email].join(', '));
  };

  const hasData =
    reportData?.tasks && reportData.tasks.length > 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Daily Report</h1>
            <p className="text-gray-500 mt-1">
              Generate and share team reports via WhatsApp and Email
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isLeader && (
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-500">Report for</span>
                <select
                  value={reportScope}
                  onChange={(e) => setReportScope(e.target.value as 'team' | 'me' | 'member')}
                  disabled={isAdmin}
                  className="text-sm text-gray-700 bg-transparent outline-none"
                >
                  <option value="team">Team</option>
                  {!isAdmin && <option value="me">Me</option>}
                  {!isAdmin && <option value="member">Team Member</option>}
                </select>
              </div>
            )}
            {!isAdmin && effectiveScope === 'member' && (
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-500">Member</span>
                <select
                  value={memberFilterId}
                  onChange={(e) => setMemberFilterId(e.target.value)}
                  className="text-sm text-gray-700 bg-transparent outline-none min-w-[170px]"
                >
                  {teamMemberOptions.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {isAdmin && isTeamScope && (
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-500">Team</span>
                <select
                  value={leaderFilterId}
                  onChange={(e) => setLeaderFilterId(e.target.value)}
                  className="text-sm text-gray-700 bg-transparent outline-none min-w-[180px]"
                >
                  <option value="all">All (Leaders + Members)</option>
                  {leaderOptions.map((leader) => (
                    <option key={leader.id} value={leader.id}>
                      By {leader.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
              <Calendar size={16} className="text-gray-400" />
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="outline-none text-sm text-gray-700 bg-transparent"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : !hasData ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <FileText size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">No tasks found for this date.</p>
            <p className="text-gray-400 text-sm mt-1">
              Try selecting a different date.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={generateAiEmail}
                disabled={emailLoading}
                className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm disabled:opacity-60"
              >
                <Mail size={18} />
                {emailLoading ? 'Generating...' : 'Generate Email (AI)'}
              </button>
              <button
                onClick={shareToWhatsApp}
                className="flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg hover:bg-green-700 transition-colors text-sm font-medium shadow-sm"
              >
                <MessageCircle size={18} />
                Share on WhatsApp
              </button>
              <button
                onClick={copyToClipboard}
                className="flex items-center gap-2 bg-white text-gray-700 border border-gray-200 px-5 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
              >
                <Copy size={18} />
                Copy Report
              </button>
              <button
                onClick={() => setPreviewModalOpen(true)}
                className="flex items-center gap-2 bg-white text-gray-700 border border-gray-200 px-5 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
              >
                <FileText size={18} />
                WhatsApp Format Preview
              </button>
            </div>

            {/* Visual Report Preview */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 bg-gradient-to-r from-primary-50 to-blue-50 border-b border-gray-100">
                <h2 className="text-lg font-bold text-gray-900">
                  {isTeamScope ? '📋 Today\'s Completed Tasks' : '📋 Daily Task Report'}
                </h2>
                <p className="text-sm text-gray-600 mt-0.5">
                  📆 Date: {reportData?.formattedDate}
                </p>
              </div>

              <div className="p-5 space-y-6">
                {reportData &&
                  Object.values(reportData.grouped).map((entry) => (
                    <div key={entry.project.id}>
                      <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
                        <span className="text-lg">{entry.project.emoji}</span>
                        {entry.project.name}
                      </h3>

                      <div className="space-y-4 pl-2">
                        {isTeamScope ? (
                          Object.values(entry.users).map((userEntry) => (
                            <div key={userEntry.user.id}>
                              <p className="text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
                                👤 {userEntry.user.name}
                              </p>
                              <div className="space-y-1 pl-4">
                                {userEntry.tasks.map((task, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center gap-2 text-sm text-gray-600"
                                  >
                                    <span className="text-gray-400 min-w-[20px]">
                                      {idx + 1}.
                                    </span>
                                    <span className="flex-1">{task.title}</span>
                                    <StatusBadge
                                      status={task.status}
                                      size="sm"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="space-y-1 pl-4">
                            {Object.values(entry.users)
                              .flatMap((userEntry) => userEntry.tasks)
                              .map((task, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-2 text-sm text-gray-600"
                                >
                                  <span className="text-gray-400 min-w-[20px]">
                                    {idx + 1}.
                                  </span>
                                  <span className="flex-1">{task.title}</span>
                                  <StatusBadge
                                    status={task.status}
                                    size="sm"
                                  />
                                </div>
                              ))}
                          </div>
                        )}
                      </div>

                      <hr className="mt-4 border-gray-100" />
                    </div>
                  ))}
              </div>
            </div>

          </div>
        )}

        <Modal
          isOpen={previewModalOpen}
          onClose={() => setPreviewModalOpen(false)}
          title="WhatsApp Format Preview"
          size="3xl"
          height="tall"
        >
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                onClick={copyToClipboard}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
              >
                <Copy size={12} />
                Copy
              </button>
            </div>
            <pre className="p-4 text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed bg-gray-50 rounded-lg border border-gray-100 max-h-96 overflow-y-auto">
              {reportData?.report}
            </pre>
          </div>
        </Modal>

        <Modal
          isOpen={emailModalOpen}
          onClose={() => {
            if (emailSending) return;
            setEmailModalOpen(false);
          }}
          title="AI Generated Email"
          size="3xl"
          height="tall"
        >
          <div className="space-y-3">
            <div className="flex justify-between items-center gap-2">
              <div className="text-xs text-gray-500">
                Configure sender SMTP in Settings, then send from here.
              </div>
              <button
                onClick={copyEmailContent}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
              >
                <Copy size={12} />
                Copy
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                <div className="relative">
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    onFocus={() => setShowToSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowToSuggestions(false), 120)}
                    placeholder="recipient@company.com"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                  {showToSuggestions && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-sm p-1">
                      {suggestedEmailOptions.map((email) => (
                        <button
                          key={`to-${email}`}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setEmailTo(email);
                            setShowToSuggestions(false);
                          }}
                          className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-gray-50 text-gray-700"
                        >
                          {email}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">CC (optional)</label>
                <div className="relative">
                  <input
                    value={emailCc}
                    onChange={(e) => setEmailCc(e.target.value)}
                    onFocus={() => setShowCcSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowCcSuggestions(false), 120)}
                    placeholder="cc1@company.com, cc2@company.com"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                  {showCcSuggestions && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-sm p-1">
                      {suggestedEmailOptions.map((email) => (
                        <button
                          key={`cc-${email}`}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            appendCcSuggestion(email);
                            setShowCcSuggestions(false);
                          }}
                          className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-gray-50 text-gray-700"
                        >
                          {email}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
              <input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Body</label>
              {emailIsHtml ? (
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-[55vh] overflow-y-auto">
                  <div
                    ref={emailBodyEditorRef}
                    className="text-sm min-h-[220px] outline-none"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => setEmailBody((e.currentTarget as HTMLDivElement).innerHTML)}
                    dangerouslySetInnerHTML={{ __html: emailBody }}
                  />
                </div>
              ) : (
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={14}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEmailModalOpen(false)}
                disabled={emailSending}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendGeneratedEmail}
                disabled={emailSending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-60"
              >
                {emailSending ? 'Sending...' : 'Send Email'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
