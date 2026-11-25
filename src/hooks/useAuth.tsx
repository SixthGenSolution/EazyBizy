import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    role: "user" | "credit_analyst" | "consultant",
  ) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;

        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        // Create profile on sign up
        if (event === "SIGNED_IN" && session?.user) {
          setTimeout(() => {
            createProfileIfNotExists(session.user.id, session.user.email);
          }, 0);
        }
      }
    );

    // THEN verify the signed-in user with Supabase and derive the current session from it.
    Promise.all([supabase.auth.getUser(), supabase.auth.getSession()])
      .then(([{ data: userData }, { data: { session } }]) => {
        if (!mounted) return;
        const currentUser = userData.user ?? session?.user ?? null;
        setSession(session);
        setUser(currentUser);
      })
      .catch((error) => {
        console.error("Auth session fetch failed:", error);
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const createProfileIfNotExists = async (
  userId: string,
  email?: string,
  fullName?: string
) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Profile check failed:", error);
    return;
  }

  if (!data) {
    console.warn(
      "Profile not found. Database trigger may not have completed.",
      userId
    );
  }
};

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    role: "user" | "credit_analyst" | "consultant",
  ) => {
    const redirectUrl = `${window.location.origin}/dashboard`;
    
    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
          role,
        },
      },
    });

    if (!error && data.user) {
      // Check if profile already exists before inserting
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (!existingProfile) {
        await supabase.from("profiles").insert({
          user_id: data.user.id,
          email: email,
          full_name: fullName,
        });
      }

      // Role is stored via auth metadata + database trigger.
    }

    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
