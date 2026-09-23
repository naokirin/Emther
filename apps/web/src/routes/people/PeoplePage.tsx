import { useState } from "react";
import styles from "../../styles/page.module.css";
import { PersonScoreBadge } from "../../components/PersonScoreBadge";
import { PersonDetailContent } from "../../components/PersonDetailContent";
import { PageTitleRow } from "../../components/HelpLink";
import { SlideOver } from "../../components/SlideOver";
import { usePeekParam } from "../../lib/usePeekParam";
import { api } from "../../lib/api-client";
import { usePeople } from "../../lib/queries";
import { PERSON_VITAL_LABEL, personVitalStatus, type PersonSummary } from "@emther/core/types";
import type { PersonMutationResponse } from "@emther/api-contract";

// web/src/app/people/page.tsx（Next.js版）からの移植（フェーズ3.5 tier2、人物バッチ）。
// react-routerのusePeekParamはSuspenseを要求しないため、元実装の<Suspense>ラッパーは
// 不要（削除した）。
function PersonCardGrid({ people, onOpen }: { people: PersonSummary[]; onOpen: (id: string) => void }) {
  return (
    <div className={styles.personCardGrid}>
      {people.map((p) => (
        <button key={p.id} type="button" className={styles.personCard} onClick={() => onOpen(p.id)}>
          <PersonScoreBadge trend={p.trend} factCount={p.factCount} hasConcerningSuggestion={p.hasConcerningSuggestion} />
          <div className={styles.personCardBody}>
            <div className={styles.personCardName}>
              {p.name}
              {p.isSelf && <span className={styles.tag} style={{ marginLeft: 6 }}>自分</span>}
            </div>
            <div className={styles.tableMuted}>
              {p.isSelf
                ? "利用者本人"
                : `${PERSON_VITAL_LABEL[personVitalStatus(p.trend, p.hasConcerningSuggestion)]}・${p.teamNames.length > 0 ? p.teamNames.join(", ") : "未所属"}`}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

export function PeoplePage() {
  const { people, peopleLoaded, refreshPeople } = usePeople();
  const peek = usePeekParam("person");
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const sorted = [...people].sort((a, b) => b.factCount - a.factCount || a.name.localeCompare(b.name, "ja"));
  const selfPeople = sorted.filter((p) => p.isSelf);
  const reports = sorted.filter((p) => p.isDirectReport);
  const others = sorted.filter((p) => !p.isDirectReport && !p.isSelf);
  const peekedPerson = peek.id ? sorted.find((p) => p.id === peek.id) : undefined;

  async function handleAddPerson(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setSubmitting(true);
    setAddError(null);
    try {
      const res = await api.api.people.$post({ json: { name } });
      const data = (await res.json().catch(() => null)) as (PersonMutationResponse & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error ?? "登録に失敗しました");
      setNewName("");
      await refreshPeople();
      if (typeof data?.person?.id === "string") peek.open(data.person.id);
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.screen}>
      <PageTitleRow title="メンバー" helpAnchor="people" />
      <div className={styles.panel}>
        <form onSubmit={handleAddPerson} style={{ marginBottom: 16 }}>
          <div className={styles.field}>
            <label>
              人物を追加
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例: 田中さん"
                disabled={submitting}
              />
            </label>
          </div>
          <button className={styles.primaryBtn} type="submit" disabled={submitting || !newName.trim()}>
            {submitting ? "登録中…" : "追加"}
          </button>
          {addError && (
            <p className={styles.errorText} role="alert" style={{ marginTop: 8 }}>
              {addError}
            </p>
          )}
        </form>

        {sorted.length === 0 ? (
          <p className={styles.subtitle}>
            {!peopleLoaded
              ? "読み込み中…"
              : "まだ誰も登録されていません。上のフォームか、チーム名簿から追加してください。"}
          </p>
        ) : (
          <>
            {selfPeople.length > 0 && (
              <>
                <h3 style={{ fontSize: "0.875rem", marginBottom: 8 }}>自分</h3>
                <div style={{ marginBottom: 20 }}>
                  <PersonCardGrid people={selfPeople} onOpen={peek.open} />
                </div>
              </>
            )}
            <h3 style={{ fontSize: "0.875rem", marginBottom: 8 }}>部下（自分が管理するチームのメンバー）</h3>
            {reports.length === 0 ? (
              <p className={styles.subtitle} style={{ marginBottom: 16 }}>
                管理チームにメンバーがいません。「チーム」で登録してください。
              </p>
            ) : (
              <div style={{ marginBottom: 20 }}>
                <PersonCardGrid people={reports} onOpen={peek.open} />
              </div>
            )}
            {others.length > 0 && (
              <>
                <h3 className={styles.axisTooltip} style={{ fontSize: "0.875rem", marginBottom: 8 }} data-tooltip="管理チーム以外で言及された人物" tabIndex={0}>
                  その他
                </h3>
                <PersonCardGrid people={others} onOpen={peek.open} />
              </>
            )}
          </>
        )}
      </div>

      {peekedPerson && (
        <SlideOver title={peekedPerson.name} detailHref={`/people/${peekedPerson.id}`} onClose={peek.close}>
          <PersonDetailContent id={peekedPerson.id} />
        </SlideOver>
      )}
    </div>
  );
}
