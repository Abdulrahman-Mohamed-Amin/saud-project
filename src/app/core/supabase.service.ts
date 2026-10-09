import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://pzhinuwtnqjreftjdaxn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6aGludXd0bnFqcmVmdGpkYXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjkwNzQsImV4cCI6MjEwNzA0NTA3NH0.CFOypGX2IeZOzY-Rpr7Q9ncyOfSHm1gKzjLoDAlqKx4';

export interface ContractRow {
  id: string;
  project_name: string;
  client_name: string;
  unit_price: number;
  first_payment: number;
  contract_date: string;
  fields: Record<string, string>;
  created_at: string;
}

export interface PaymentNote {
  text: string;
  date: string;
}

export interface PaymentRow {
  id: string;
  contract_id: string;
  installment_number: number;
  label: string;
  amount: number;
  due_date: string;
  paid: boolean;
  paid_at: string | null;
  /** المبلغ المدفوع فعلياً من هذه الدفعة حتى الآن — قد يكون أقل من amount لو العميل دفع جزء بس */
  paid_amount: number;
  /** ملاحظات الدفعة — كل ملاحظة بتاريخ إضافتها (YYYY-MM-DD) */
  notes: PaymentNote[];
  contacted: boolean;
  contacted_at: string | null;
  last_reminded_at: string | null;
  reminder_count: number;
}

export interface ContractWithPayments extends ContractRow {
  payments: PaymentRow[];
}

export interface ArchivedContract {
  id: string;
  original_contract_id: string;
  project_name: string;
  client_name: string;
  unit_price: number;
  first_payment: number;
  contract_date: string | null;
  fields: Record<string, string>;
  /** نسخة كاملة من دفعات العقد وقت الأرشفة (بملاحظاتها والمبالغ المدفوعة) */
  payments: PaymentRow[];
  reason: 'replaced' | 'renewed';
  archived_at: string;
}

/** نص افتراضي ثابت يُخزَّن وقت إنشاء العقد (لا يُستخدم للعرض — العرض يعتمد على رقم القسط
 *  مترجَماً ديناميكياً حسب لغة الواجهة). يدعم أي عدد من الدفعات بخلاف القائمة الثابتة القديمة
 *  التي كانت محدودة بـ 6 عناصر فقط وتكسر الحفظ لأي عدد دفعات أكبر. */
function installmentLabel(n: number): string {
  return `الدفعة ${n}`;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

  getClient(): SupabaseClient { return this.db; }

  /** Load all projects ordered by creation */
  async loadProjects(): Promise<{ id: string; name: string }[]> {
    const { data } = await this.db.from('projects').select('id, name').order('created_at');
    return data ?? [];
  }

  /** Create a new project — returns false if name already exists */
  async saveProject(name: string): Promise<boolean> {
    const { error } = await this.db.from('projects').insert({ name });
    return !error;
  }

  /** Rename a project — updates both the projects table and all its contracts */
  async renameProject(oldName: string, newName: string): Promise<boolean> {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return false;
    const { error: pe } = await this.db.from('projects').update({ name: trimmed }).eq('name', oldName);
    if (pe) return false;
    const { error: ce } = await this.db.from('contracts').update({ project_name: trimmed }).eq('project_name', oldName);
    return !ce;
  }

  /** Delete a project and all its contracts/payments */
  async deleteProject(id: string): Promise<boolean> {
    const { data: proj } = await this.db.from('projects').select('name').eq('id', id).single();
    if (!proj) return false;
    // contracts → payments cascade in DB
    await this.db.from('contracts').delete().eq('project_name', proj.name);
    const { error } = await this.db.from('projects').delete().eq('id', id);
    return !error;
  }

  /** Check for a duplicate client within a project. Unit code is the real source of
   *  truth for uniqueness (a physical unit can only be sold/contracted once) — so when
   *  a unit code is given, only IT is checked, and a matching name under a *different*
   *  unit code is allowed through (a client can legitimately buy more than one unit in
   *  the same project). Name is checked only as a fallback when no unit code is given
   *  at all, since that's the only signal left to catch an accidental re-entry.
   *  Returns 'unit' | 'name' | null */
  async checkDuplicate(projectName: string, clientName: string, unitCode: string): Promise<'name' | 'unit' | null> {
    if (unitCode.trim()) {
      const { data: byUnit } = await this.db.from('contracts')
        .select('id')
        .eq('project_name', projectName)
        .filter('fields->>unit_code', 'ilike', unitCode.trim())
        .limit(1);
      return byUnit?.length ? 'unit' : null;
    }

    if (clientName.trim()) {
      const { data: byName } = await this.db.from('contracts')
        .select('id')
        .eq('project_name', projectName)
        .ilike('client_name', clientName.trim())
        .limit(1);
      if (byName?.length) return 'name';
    }

    return null;
  }

  /** Save a new contract + auto-create its 6 payment rows */
  async saveContract(data: {
    projectName: string;
    clientName: string;
    unitPrice: number;
    firstPayment: number;
    contractDate: string;
    fields: Record<string, string>;
    installments: { amount: number; dueDate: string; paid?: boolean }[];
  }): Promise<{ contractId: string } | { error: string }> {
    const { data: contract, error: ce } = await this.db
      .from('contracts')
      .insert({
        project_name: data.projectName,
        client_name: data.clientName,
        unit_price: data.unitPrice,
        first_payment: data.firstPayment,
        contract_date: data.contractDate,
        fields: data.fields,
      })
      .select('id')
      .single();

    if (ce || !contract) return { error: ce?.message ?? 'خطأ في حفظ العقد' };

    const now = new Date().toISOString();
    const paymentRows = data.installments.map((inst, i) => {
      const paid = inst.paid ?? (i === 0);
      return {
        contract_id: contract.id,
        installment_number: i + 1,
        label: installmentLabel(i + 1),
        amount: inst.amount,
        due_date: inst.dueDate,
        paid,
        paid_at: paid ? now : null,
        paid_amount: paid ? inst.amount : 0,
      };
    });

    const { error: pe } = await this.db.from('payments').insert(paymentRows);    if (pe) return { error: pe.message };

    return { contractId: contract.id };
  }

  /** Load all contracts with their payments */
  async loadContracts(): Promise<ContractWithPayments[]> {
    const { data, error } = await this.db
      .from('contracts')
      .select('*, payments(*)')
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return data.map((c: any) => ({
      ...c,
      payments: (c.payments as PaymentRow[]).sort(
        (a, b) => a.installment_number - b.installment_number
      ),
    }));
  }

  /** Toggle paid status of a single payment — also syncs paid_amount to the full amount
   *  when marking paid, or back to 0 when cancelling (undoes any partial-payment tracking) */
  async togglePayment(id: string, currentPaid: boolean, amount: number): Promise<boolean> {
    const nowPaid = !currentPaid;
    const { error } = await this.db
      .from('payments')
      .update({ paid: nowPaid, paid_at: nowPaid ? new Date().toISOString() : null, paid_amount: nowPaid ? amount : 0 })
      .eq('id', id);
    return !error;
  }

  /** Toggle contacted status of a single payment */
  async toggleContacted(id: string, current: boolean): Promise<boolean> {
    const { error } = await this.db
      .from('payments')
      .update({ contacted: !current, contacted_at: !current ? new Date().toISOString() : null })
      .eq('id', id);
    return !error;
  }

  /** Checks whether a contract with the exact same client name AND unit code already
   *  exists in the project — a true duplicate re-import, as opposed to checkDuplicate()
   *  which matches on unit code alone (or name alone) to support legitimate corrections
   *  (e.g. fixing a typo'd unit code for an existing client).
   *  Returns the existing contract's id, or null if no exact (name + unit) match. */
  async findExactDuplicateId(projectName: string, clientName: string, unitCode: string): Promise<string | null> {
    if (!clientName.trim() || !unitCode.trim()) return null;
    const { data } = await this.db.from('contracts')
      .select('id')
      .eq('project_name', projectName)
      .ilike('client_name', clientName.trim())
      .filter('fields->>unit_code', 'ilike', unitCode.trim())
      .limit(1)
      .maybeSingle();
    return data?.id ?? null;
  }

  /** Update fields + client_name for existing contract by unit_code within a project.
   *  Merges new fields into existing ones — only non-empty values overwrite. */
  async updateContractByUnitCode(
    projectName: string,
    unitCode: string,
    updates: { client_name?: string; fields?: Record<string, string> }
  ): Promise<string | null> {
    const { data } = await this.db
      .from('contracts')
      .select('id, fields')
      .eq('project_name', projectName)
      .filter('fields->>unit_code', 'ilike', unitCode.trim())
      .limit(1)
      .single();
    if (!data) return null;

    // Merge: keep existing values for keys that are empty/missing in the update
    const existing: Record<string, string> = (data as any).fields ?? {};
    const incoming = updates.fields ?? {};
    const mergedFields: Record<string, string> = { ...existing };
    for (const [k, v] of Object.entries(incoming)) {
      if (v !== '' && v !== null && v !== undefined) mergedFields[k] = v;
    }

    const payload: Record<string, any> = { fields: mergedFields };
    if (updates.client_name) payload['client_name'] = updates.client_name;

    const { error } = await this.db.from('contracts').update(payload).eq('id', (data as any).id);
    return error ? null : (data as any).id;
  }

  /** Update fields + client_name for existing contract by client name within a project. */
  async updateContractByName(
    projectName: string,
    clientName: string,
    updates: { client_name?: string; fields?: Record<string, string> }
  ): Promise<string | null> {
    const { data } = await this.db
      .from('contracts')
      .select('id, fields')
      .eq('project_name', projectName)
      .ilike('client_name', clientName.trim())
      .limit(1)
      .single();
    if (!data) return null;

    const existing: Record<string, string> = (data as any).fields ?? {};
    const incoming = updates.fields ?? {};
    const mergedFields: Record<string, string> = { ...existing };
    for (const [k, v] of Object.entries(incoming)) {
      if (v !== '' && v !== null && v !== undefined) mergedFields[k] = v;
    }

    const payload: Record<string, any> = { fields: mergedFields };
    if (updates.client_name) payload['client_name'] = updates.client_name;

    const { error } = await this.db.from('contracts').update(payload).eq('id', (data as any).id);
    return error ? null : (data as any).id;
  }

  /** Sync paid/unpaid status of a contract's installments to match the given per-installment flags.
   *  paidFlags[0] = installment_number 1, paidFlags[1] = installment_number 2, etc.
   *  Only touches installments actually present, and only writes rows whose status changed. */
  async syncPaymentStatuses(contractId: string, paidFlags: boolean[]): Promise<boolean> {
    const { data, error } = await this.db
      .from('payments')
      .select('id, installment_number, paid, amount')
      .eq('contract_id', contractId);
    if (error || !data) return false;

    const now = new Date().toISOString();
    const updates = data
      .filter(p => paidFlags[p.installment_number - 1] !== undefined && paidFlags[p.installment_number - 1] !== p.paid)
      .map(p => {
        const paid = paidFlags[p.installment_number - 1];
        return this.db.from('payments').update({ paid, paid_at: paid ? now : null, paid_amount: paid ? p.amount : 0 }).eq('id', p.id);
      });

    const results = await Promise.all(updates);
    return results.every(r => !r.error);
  }

  /** Send an early reminder email for a single payment */
  async sendEarlyReminder(paymentId: string, projectName: string): Promise<{ sent: boolean; reminder_count?: number; limit_reached?: boolean; error?: string }> {
    const { data, error } = await this.db.functions.invoke('send-early-reminder', {
      body: { payment_id: paymentId, project_name: projectName },
    });
    if (error) return { sent: false, error: error.message };
    return data ?? { sent: false };
  }

  /** Delete a contract and its payments (CASCADE) */
  async deleteContract(id: string): Promise<boolean> {
    const { error } = await this.db.from('contracts').delete().eq('id', id);
    return !error;
  }

  /** Update client_name, contract_date and/or fields of a contract */
  async updateContract(id: string, updates: {
    client_name?: string;
    contract_date?: string;
    unit_price?: number;
    first_payment?: number;
    fields?: Record<string, string>;
  }): Promise<boolean> {
    const { error } = await this.db.from('contracts').update(updates).eq('id', id);
    return !error;
  }

  /** Inserts additional payment installments for an existing contract (e.g. the client's
   *  installment count was increased while editing) — new rows always start unpaid. */
  async addPayments(contractId: string, rows: { installmentNumber: number; amount: number; dueDate: string }[]): Promise<boolean> {
    if (!rows.length) return true;
    const payload = rows.map(r => ({
      contract_id: contractId,
      installment_number: r.installmentNumber,
      label: installmentLabel(r.installmentNumber),
      amount: r.amount,
      due_date: r.dueDate,
      paid: false,
      paid_at: null,
      paid_amount: 0,
    }));
    const { error } = await this.db.from('payments').insert(payload);
    return !error;
  }

  /** Update the amount and/or due_date of a single payment installment — used for one-off
   *  exceptions where a client's schedule/amount needs to diverge from the standard plan
   *  without touching the rest of their installments. */
  async updatePayment(id: string, updates: {
    amount?: number;
    due_date?: string;
    paid?: boolean;
    paid_at?: string | null;
    paid_amount?: number;
    notes?: PaymentNote[];
  }): Promise<boolean> {
    const { error } = await this.db.from('payments').update(updates).eq('id', id);
    return !error;
  }

  /** Permanently delete a single payment installment (e.g. a client renegotiated down to
   *  fewer installments). Use renumberPayments() afterwards to keep the remaining
   *  installments' numbering/labels sequential. */
  async deletePayment(id: string): Promise<boolean> {
    const { error } = await this.db.from('payments').delete().eq('id', id);
    return !error;
  }

  /** Renumbers a contract's remaining payments sequentially (1..n) in the given order —
   *  called after deletePayment() so installment_number/label stay consistent with their
   *  chronological position instead of leaving a gap. */
  async renumberPayments(orderedIds: string[]): Promise<boolean> {
    const results = await Promise.all(
      orderedIds.map((id, i) => this.db.from('payments').update({
        installment_number: i + 1,
        label: installmentLabel(i + 1),
      }).eq('id', id))
    );
    return results.every(r => !r.error);
  }

  /** يحفظ نسخة كاملة من العقد ودفعاته في الأرشيف، ثم يبدأ العقد من جديد بدفعات جديدة
   *  (تغيير العميل أو تجديد سنة جديدة). الأرشفة تتم أولاً — فلو فشلت لا يُمسّ أي شيء. */
  async archiveAndRestart(
    contract: ContractWithPayments,
    reason: 'replaced' | 'renewed',
    updates: { client_name: string; contract_date: string; unit_price: number; first_payment: number; fields: Record<string, string> },
    rows: { installmentNumber: number; amount: number; dueDate: string }[],
  ): Promise<boolean> {
    const { payments, ...info } = contract;
    const { error: ae } = await this.db.from('archived_contracts').insert({
      original_contract_id: contract.id,
      project_name: info.project_name,
      client_name: info.client_name,
      unit_price: info.unit_price,
      first_payment: info.first_payment,
      contract_date: info.contract_date,
      fields: info.fields,
      payments,
      reason,
    });
    if (ae) return false;

    const { error: de } = await this.db.from('payments').delete().eq('contract_id', contract.id);
    if (de) return false;
    if (!(await this.updateContract(contract.id, updates))) return false;
    return this.addPayments(contract.id, rows);
  }

  /** الأرشيف السابق لعقد معيّن، الأحدث أولاً */
  async loadArchive(contractId: string): Promise<ArchivedContract[]> {
    const { data, error } = await this.db
      .from('archived_contracts')
      .select('*')
      .eq('original_contract_id', contractId)
      .order('archived_at', { ascending: false });
    return error || !data ? [] : (data as ArchivedContract[]);
  }

}
