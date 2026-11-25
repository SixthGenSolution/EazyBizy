import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import LearningAccessGate from "./LearningAccessGate (1)";

type RequireLearningAuthProps = {
  children: ReactNode;
};

const buildLearningRedirectPath = (pathname: string, search: string, hash: string) => {
  const fullPath = `${pathname}${search}${hash}`;
  return fullPath.startsWith("/learning") ? fullPath : "/learning";
};

const RequireLearningAuth = ({ children }: RequireLearningAuthProps) => {
  const location = useLocation();
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,#e0f7ff_0%,#f8fbff_44%,#eef5ff_100%)] px-4">
        <div className="w-full max-w-md rounded-[32px] border border-white/80 bg-white/95 p-8 text-center shadow-[0_34px_90px_-46px_rgba(15,23,42,0.34)]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-[linear-gradient(135deg,#083344_0%,#0891b2_100%)] text-white shadow-[0_24px_50px_-28px_rgba(8,145,178,0.55)]">
            <BookOpen className="h-7 w-7" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-950">Loading EazyBizy Learning</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Checking your access so we can open the right learning page for you.
          </p>
          <div className="mx-auto mt-6 h-2 w-44 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[linear-gradient(90deg,#0891b2_0%,#22c55e_100%)]" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LearningAccessGate
        redirectTo={buildLearningRedirectPath(location.pathname, location.search, location.hash)}
      />
    );
  }

  return <>{children}</>;
};

export default RequireLearningAuth;
