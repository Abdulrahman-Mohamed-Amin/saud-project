// Shared HTML email template + Resend sender for all reminder/statement functions.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export interface EmailRow {
  label: string;
  amount: number;
  dueDate: string;
  paid: boolean;
}

/** Builds the shared header/table/footer HTML used by every outgoing email. */
export function buildEmailHtml(opts: {
  title: string;
  clientName: string;
  intro: string;
  rows: EmailRow[];
  summaryLines?: string[];
}): string {
  const rowsHtml = opts.rows.map(r => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${r.label}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${formatDate(r.dueDate)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${fmt(r.amount)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${r.paid ? 'مدفوع' : 'غير مدفوع'}</td>
    </tr>`).join('');

  const summaryHtml = (opts.summaryLines ?? [])
    .map(l => `<p style="margin:4px 0;color:#374151;">${l}</p>`).join('');

  return `
  <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#f3f4f6;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#0f172a;color:#fff;padding:20px 24px;">
        <h1 style="margin:0;font-size:18px;">${opts.title}</h1>
      </div>
      <div style="padding:20px 24px;">
        <p style="margin:0 0 12px;color:#111827;">عزيزي/عزيزتي ${opts.clientName}،</p>
        <p style="margin:0 0 16px;color:#374151;">${opts.intro}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;text-align:right;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 14px;border-bottom:2px solid #e5e7eb;">الدفعة</th>
              <th style="padding:10px 14px;border-bottom:2px solid #e5e7eb;">تاريخ الاستحقاق</th>
              <th style="padding:10px 14px;border-bottom:2px solid #e5e7eb;">المبلغ</th>
              <th style="padding:10px 14px;border-bottom:2px solid #e5e7eb;">الحالة</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${summaryHtml ? `<div style="margin-top:16px;">${summaryHtml}</div>` : ''}
      </div>
      <div style="background:#f9fafb;padding:14px 24px;color:#9ca3af;font-size:12px;">
        هذه رسالة آلية، برجاء عدم الرد عليها مباشرة.
      </div>
    </div>
  </div>`;
}

/** Sends an email via the Resend API. RESEND_API_KEY and FROM_EMAIL must be set as function secrets. */
export async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('FROM_EMAIL');
  if (!apiKey || !from) return { ok: false, error: 'missing RESEND_API_KEY/FROM_EMAIL secret' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `resend error (${res.status}): ${body}` };
  }
  return { ok: true };
}

export function clientEmail(fields: Record<string, string> | null | undefined): string {
  const f = fields ?? {};
  return f['email'] || f['mail'] || f['الايميل'] || f['البريد'] || f['البريد_الالكتروني'] || f['client_email'] || '';
}
