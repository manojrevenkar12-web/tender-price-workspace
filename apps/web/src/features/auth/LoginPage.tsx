import { motion } from "framer-motion";
import { type FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";

import { Button, SkeletonRows } from "../../shared/ui";
import { motion as m } from "../../shared/theme/tokens";
import { useDemoUsers, useSignIn } from "./api";
import styles from "./LoginPage.module.css";
import { useSession } from "./useSession";

export function LoginPage() {
  const s = useSession();
  const users = useDemoUsers();
  const signIn = useSignIn();
  const [email, setEmail] = useState("");
  if (s) return <Navigate to={s.user.kind === "contractor" ? "/tenders" : "/bids"} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (email) signIn.mutate(email);
  };
  const buyers = users.data?.filter((u) => u.kind === "contractor") ?? [];
  const bidders = users.data?.filter((u) => u.kind === "subcontractor").slice(0, 4) ?? [];

  return (
    <main className={styles.page}>
      <section className={styles.intro}>
        <span className={styles.wordmark}>tender price workspace</span>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: m.slow, ease: m.ease }}
        >
          <h1 className={styles.claim}>Every bid, every position, against what the work really costs.</h1>
        </motion.div>
        <p className={styles.lede}>
          Bills of quantities, bids and two million historical unit prices in one place, so buyers award on
          evidence and bidders price the current version.
        </p>
      </section>
      <section className={styles.form} aria-labelledby="signin">
        <h2 className={styles.heading} id="signin">
          Sign in
        </h2>
        {users.isPending && <SkeletonRows rows={4} height="3.25rem" label="Loading demo users" />}
        {users.isSuccess && (
          <>
            <div className={styles.group}>
              <span className={styles.groupTitle}>Buying (general contractor)</span>
              {buyers.map((u) => (
                <UserButton
                  key={u.email}
                  name={u.name}
                  org={u.org}
                  email={u.email}
                  onPick={() => signIn.mutate(u.email)}
                />
              ))}
            </div>
            <div className={styles.group}>
              <span className={styles.groupTitle}>Bidding (subcontractor)</span>
              {bidders.map((u) => (
                <UserButton
                  key={u.email}
                  name={u.name}
                  org={u.org}
                  email={u.email}
                  onPick={() => signIn.mutate(u.email)}
                />
              ))}
            </div>
          </>
        )}
        <form className={styles.manual} onSubmit={submit}>
          <label className="visually-hidden" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            className={styles.input}
            type="email"
            placeholder="name@company.example"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" variant="primary" busy={signIn.isPending}>
            Sign in
          </Button>
        </form>
        {signIn.isError && (
          <p className={styles.error} role="alert">
            {signIn.error.message}
          </p>
        )}
      </section>
    </main>
  );
}

function UserButton({
  name,
  org,
  email,
  onPick,
}: {
  name: string;
  org: string;
  email: string;
  onPick: () => void;
}) {
  return (
    <button type="button" className={styles.user} onClick={onPick} data-cy="demo-user" data-email={email}>
      <span>
        <span className={styles.org}>{org}</span>
        <br />
        <span className={styles.email}>
          {name}, {email}
        </span>
      </span>
      <span aria-hidden>Sign in</span>
    </button>
  );
}
