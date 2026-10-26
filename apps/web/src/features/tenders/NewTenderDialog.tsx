import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Dialog } from "../../shared/ui";
import { useCreateFromGaeb, useProjects } from "./api";
import { TRADE_LABEL } from "./status";
import styles from "./TenderListPage.module.css";

export function NewTenderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projects = useProjects();
  const create = useCreateFromGaeb();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState("");
  const [trade, setTrade] = useState("concrete");
  const [file, setFile] = useState<File | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const xml = await file.text();
    const r = await create.mutateAsync({ projectId: projectId || projects.data?.[0]?.id || "", trade, xml });
    onClose();
    navigate(`/tenders/${r.id}`);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New tender from GAEB"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-tender" busy={create.isPending} disabled={!file}>
            Create draft
          </Button>
        </>
      }
    >
      <form id="new-tender" className={styles.form} onSubmit={(e) => void submit(e)}>
        <label className={styles.field}>
          Project
          <select className={styles.input} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}, {p.city}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Trade
          <select className={styles.input} value={trade} onChange={(e) => setTrade(e.target.value)}>
            {Object.entries(TRADE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Bill of quantities (GAEB X83)
          <input
            className={styles.input}
            type="file"
            accept=".x83,.xml"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {create.isError && (
          <p className={styles.error} role="alert">
            {create.error.message}
          </p>
        )}
      </form>
    </Dialog>
  );
}
