import { useState, type ChangeEvent, type FormEvent } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff, Home, Lock, LogIn, Mail, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const primaryButtonClass =
  "bg-gradient-to-r from-cyan-400 to-sky-500 text-base font-extrabold text-slate-950 shadow-[0_14px_28px_rgba(6,182,212,0.24)] hover:from-cyan-300 hover:to-sky-400";

const inputClass =
  "h-12 border-cyan-100 bg-cyan-50/40 pl-10 text-slate-950 placeholder:text-slate-400 focus-visible:ring-cyan-300";

const AuthPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const redirectTo =
    typeof (location.state as { from?: { pathname?: string } } | null)?.from?.pathname === "string"
      ? (location.state as { from: { pathname: string } }).from.pathname
      : null;

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();

    if (!formData.email || !formData.password) {
      toast({
        variant: "destructive",
        title: "Missing Fields",
        description: "Please enter both email and password.",
      });
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (error) throw error;

      if (!data.user) {
        throw new Error("Login failed");
      }

      const { data: analystData } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", data.user.id)
        .eq("role", "credit_analyst")
        .maybeSingle();

      toast({
        title: "Welcome Back!",
        description: "You have successfully logged in.",
      });

      setTimeout(() => {
        if (redirectTo) {
          navigate(redirectTo, { replace: true });
        } else if (analystData) {
          navigate("/credit-analyst", { replace: true });
        } else {
          navigate("/home", { replace: true });
        }
      }, 300);
    } catch (error: any) {
      console.error("Login error:", error);
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: error?.message || "Invalid credentials. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_12%_14%,rgba(6,182,212,0.26),transparent_34%),radial-gradient(circle_at_88%_82%,rgba(20,184,166,0.18),transparent_30%),linear-gradient(135deg,#dffbff_0%,#f4feff_46%,#eefdfb_100%)] p-4 text-slate-950">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
        className="absolute left-5 top-5"
      >
        <Link
          to="/"
          className="group flex items-center gap-2.5 rounded-xl border border-cyan-300 bg-gradient-to-r from-cyan-400 to-sky-500 px-4 py-2.5 text-sm font-extrabold text-slate-950 shadow-[0_14px_28px_rgba(6,182,212,0.24)] transition-all duration-200 hover:-translate-y-0.5 hover:from-cyan-300 hover:to-sky-400 active:scale-95"
        >
          <Home className="h-4 w-4 transition-transform duration-200" />
          Home
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="overflow-hidden rounded-[2rem] border border-cyan-100/90 bg-cyan-50/60 shadow-[0_30px_90px_rgba(8,145,178,0.20)] backdrop-blur">
          <CardHeader className="relative border-b border-cyan-100/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8feff_62%,#ecfeff_100%)] px-7 pb-8 pt-7 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="mx-auto mb-4 h-16 w-16 overflow-hidden rounded-full border border-cyan-100 bg-white shadow-[0_14px_35px_rgba(8,145,178,0.16)]"
            >
              <img src="/logo.png" alt="EazyBizy" className="h-full w-full object-contain p-1" />
            </motion.div>
            <CardTitle className="text-4xl font-extrabold text-slate-950">Welcome Back</CardTitle>
            <CardDescription className="mt-2 text-lg font-semibold text-slate-600">
              Sign in to EazyBizy Loan
            </CardDescription>
          </CardHeader>

          <CardContent className="bg-[linear-gradient(180deg,#f8feff_0%,#f1fdff_45%,#ffffff_100%)] px-7 py-8">
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-extrabold text-slate-800">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-600" />
                  <Input
                    type="email"
                    name="email"
                    placeholder="Enter your email"
                    value={formData.email}
                    onChange={handleChange}
                    className={inputClass}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-extrabold text-slate-800">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-600" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleChange}
                    className={`${inputClass} pr-10`}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-cyan-700"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="text-right">
                <button
                  type="button"
                  className="text-sm font-extrabold text-cyan-700 hover:underline"
                  onClick={() => {
                    toast({
                      title: "Password Reset",
                      description: "Password reset feature coming soon!",
                    });
                  }}
                >
                  Forgot Password?
                </button>
              </div>

              <Button type="submit" className={`w-full ${primaryButtonClass}`} disabled={loading} size="lg">
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-slate-950" />
                    Signing In...
                  </div>
                ) : (
                  <>
                    <LogIn className="mr-2 h-4 w-4" />
                    Sign In
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-base font-semibold text-slate-700">
                Don't have an account?{" "}
                <button onClick={() => navigate("/signup")} className="font-extrabold text-cyan-700 hover:underline">
                  Create Account
                </button>
              </p>
            </div>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-cyan-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-cyan-50 px-3 font-extrabold text-slate-500">New User?</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate("/signup")}
                className="rounded-2xl border border-cyan-200 bg-[linear-gradient(145deg,#ffffff_0%,#effdff_100%)] p-4 text-center shadow-[0_12px_28px_rgba(8,145,178,0.10)] transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400 hover:shadow-[0_18px_38px_rgba(8,145,178,0.16)]"
              >
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-cyan-200">
                  <User className="h-5 w-5 text-cyan-600" />
                </div>
                <div className="text-sm font-extrabold text-slate-950">Apply for Loan</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">Sign up as User</div>
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate("/signup")}
                className="rounded-2xl border border-cyan-300 bg-[linear-gradient(145deg,#ffffff_0%,#e7fbfd_100%)] p-4 text-center shadow-[0_12px_28px_rgba(8,145,178,0.12)] transition-all duration-300 hover:-translate-y-1 hover:border-cyan-500 hover:shadow-[0_18px_38px_rgba(8,145,178,0.18)]"
              >
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300 to-teal-400 shadow-sm">
                  <ShieldCheck className="h-5 w-5 text-slate-950" />
                </div>
                <div className="text-sm font-extrabold text-slate-950">Credit Analyst</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">Professional Access</div>
              </motion.button>
            </div>
          </CardContent>
        </Card>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-6 text-center"
        >
          <p className="text-sm font-semibold text-slate-500">Secure authentication powered by Supabase</p>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default AuthPage;
