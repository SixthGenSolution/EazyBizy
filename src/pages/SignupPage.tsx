import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Home,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const primaryButtonClass =
  "bg-gradient-to-r from-cyan-400 to-sky-500 text-base font-extrabold text-slate-950 shadow-[0_14px_28px_rgba(6,182,212,0.24)] hover:from-cyan-300 hover:to-sky-400";

const inputClass =
  "h-12 border-cyan-100 bg-cyan-50/40 pl-10 text-slate-950 placeholder:text-slate-400 focus-visible:ring-cyan-300";

const SignupPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    phone: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"user" | "analyst" | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleBackToRoleSelection = () => {
    setSelectedRole(null);
  };

  const validateForm = () => {
    if (!selectedRole) {
      toast({
        variant: "destructive",
        title: "Role Required",
        description: "Please select your role to continue.",
      });
      return false;
    }

    if (!formData.fullName.trim()) {
      toast({
        variant: "destructive",
        title: "Name Required",
        description: "Please enter your full name.",
      });
      return false;
    }

    if (!formData.email.trim() || !formData.email.includes("@")) {
      toast({
        variant: "destructive",
        title: "Invalid Email",
        description: "Please enter a valid email address.",
      });
      return false;
    }

    if (formData.password.length < 6) {
      toast({
        variant: "destructive",
        title: "Weak Password",
        description: "Password must be at least 6 characters long.",
      });
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      toast({
        variant: "destructive",
        title: "Password Mismatch",
        description: "Passwords do not match. Please try again.",
      });
      return false;
    }

    return true;
  };

  const generateClientId = () => {
    const prefix = selectedRole === "analyst" ? "CA" : "CL";
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
    return `${prefix}${timestamp}${random}`;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setLoading(true);

    try {
      const clientId = generateClientId();

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: formData.fullName,
            role: selectedRole === "analyst" ? "credit_analyst" : "user",
          },
        },
      });

      if (authError) throw authError;

      if (!authData.user) {
        throw new Error("User creation failed");
      }

      const { error: profileError } = await supabase.from("profiles").insert({
        user_id: authData.user.id,
        full_name: formData.fullName,
        email: formData.email,
        phone: formData.phone || null,
        client_id: clientId,
      });

      if (profileError) throw profileError;

      await supabase.from("user_roles").insert({
        user_id: authData.user.id,
        role: selectedRole === "analyst" ? "credit_analyst" : "user",
      });

      toast({
        title: "Account Created!",
        description:
          selectedRole === "analyst"
            ? "Your credit analyst account has been created successfully."
            : "Your account has been created. Please check your email to verify.",
      });

      setTimeout(() => {
        if (selectedRole === "analyst") {
          navigate("/credit-analyst-dashboard");
        } else {
          navigate("/dashboard");
        }
      }, 2000);
    } catch (error: any) {
      console.error("Signup error:", error);
      toast({
        variant: "destructive",
        title: "Signup Failed",
        description: error?.message || "Something went wrong. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_12%_14%,rgba(6,182,212,0.26),transparent_34%),radial-gradient(circle_at_88%_82%,rgba(20,184,166,0.18),transparent_30%),linear-gradient(135deg,#dffbff_0%,#f4feff_46%,#eefdfb_100%)] p-4 text-slate-950">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-6xl"
      >
        <Card className="overflow-hidden rounded-[2rem] border border-cyan-100/90 bg-cyan-50/60 shadow-[0_30px_90px_rgba(8,145,178,0.20)] backdrop-blur">
          <CardHeader className="relative border-b border-cyan-100/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8feff_62%,#ecfeff_100%)] px-5 pb-8 pt-7 text-center sm:px-10">
            <div className="absolute left-5 top-5 flex items-center gap-2 sm:left-6 sm:top-6">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white px-3 py-2 text-xs font-semibold text-cyan-700 shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50"
              >
                <Home className="h-4 w-4" />
                Home
              </button>
              {selectedRole && (
                <button
                  type="button"
                  onClick={handleBackToRoleSelection}
                  className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white px-3 py-2 text-xs font-semibold text-cyan-700 shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
              )}
            </div>

            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="mx-auto mb-4 mt-8 h-20 w-20 overflow-hidden rounded-full border border-cyan-100 bg-white shadow-[0_14px_35px_rgba(8,145,178,0.16)] sm:mt-0"
            >
              <img src="/logo.png" alt="EazyBizy" className="h-full w-full object-contain p-1" />
            </motion.div>
            <CardTitle className="text-4xl font-extrabold text-slate-950">Join EazyBizy</CardTitle>
            <CardDescription className="mt-2 text-lg font-semibold text-slate-600">
              Why Work Harder When You Can Work Smarter?
            </CardDescription>
          </CardHeader>

          <CardContent className="bg-[linear-gradient(180deg,#f8feff_0%,#f1fdff_45%,#ffffff_100%)] px-5 py-8 sm:px-10">
            {!selectedRole ? (
              <div className="space-y-6">
                <h3 className="mb-6 text-center text-2xl font-extrabold text-slate-950">Select Your Role</h3>

                <div className="grid gap-6 md:grid-cols-2">
                  <motion.div
                    whileHover={{ scale: 1.03, y: -5 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedRole("user")}
                    className="cursor-pointer"
                  >
                    <Card className="relative h-full overflow-hidden border border-cyan-200/90 bg-[linear-gradient(145deg,#ffffff_0%,#effdff_58%,#dcf8fb_100%)] shadow-[0_20px_55px_rgba(8,145,178,0.12)] transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400 hover:shadow-[0_28px_70px_rgba(8,145,178,0.20)]">
                      <div className="absolute -left-14 -top-14 h-40 w-40 rounded-full bg-cyan-200/45 blur-sm" />
                      <div className="absolute -bottom-20 right-8 h-48 w-48 rounded-full bg-sky-200/45" />
                      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-300 via-sky-400 to-cyan-300" />
                      <CardContent className="relative flex flex-col items-center justify-center space-y-4 p-8">
                        <motion.div
                          whileHover={{ rotate: 360 }}
                          transition={{ duration: 0.5 }}
                          className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-[0_14px_35px_rgba(8,145,178,0.14)] ring-1 ring-cyan-200"
                        >
                          <User className="h-10 w-10 text-cyan-600" />
                        </motion.div>
                        <h4 className="text-3xl font-extrabold text-slate-950">Loan Applicant</h4>
                        <p className="max-w-md text-center text-lg font-semibold leading-relaxed text-slate-700">
                          Apply for loans, track applications, and manage your financial journey
                        </p>
                        <ul className="mt-4 w-full space-y-2 text-base font-semibold text-slate-700">
                          <li className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-cyan-500" />
                            Submit loan applications
                          </li>
                          <li className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-cyan-500" />
                            Track application status in real-time
                          </li>
                          <li className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-cyan-500" />
                            View credit score and eligibility
                          </li>
                          <li className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-cyan-500" />
                            Manage documents securely
                          </li>
                        </ul>
                        <Button className={`mt-6 w-full ${primaryButtonClass}`} size="lg">
                          Sign Up as Applicant
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>

                  <motion.div
                    whileHover={{ scale: 1.03, y: -5 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedRole("analyst")}
                    className="cursor-pointer"
                  >
                    <Card className="relative h-full overflow-hidden border border-cyan-300 bg-[linear-gradient(145deg,#ffffff_0%,#edfdff_50%,#d8f9f8_100%)] shadow-[0_20px_55px_rgba(8,145,178,0.14)] transition-all duration-300 hover:-translate-y-1 hover:border-cyan-500 hover:shadow-[0_28px_70px_rgba(8,145,178,0.22)]">
                      <div className="absolute right-0 top-0 h-44 w-44 rounded-bl-full bg-cyan-200/75" />
                      <div className="absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-teal-200/45" />
                      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-teal-300 via-cyan-400 to-sky-400" />
                      <CardContent className="relative flex flex-col items-center justify-center space-y-4 p-8">
                        <motion.div
                          whileHover={{ rotate: 360 }}
                          transition={{ duration: 0.5 }}
                          className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300 to-teal-400 shadow-[0_16px_35px_rgba(20,184,166,0.25)]"
                        >
                          <ShieldCheck className="h-10 w-10 text-slate-950" />
                        </motion.div>
                        <div className="relative">
                          <h4 className="text-3xl font-extrabold text-slate-950">Credit Analyst</h4>
                          <motion.div
                            animate={{ x: [0, 10, -10, 6, -6, 0], y: [0, -6, 6, -4, 4, 0] }}
                            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                            className="absolute -right-14 -top-2 select-none rounded-full bg-cyan-400 px-2.5 py-1 text-xs font-extrabold text-slate-950 shadow-sm"
                          >
                            Professional
                          </motion.div>
                        </div>
                        <p className="max-w-md text-center text-lg font-semibold leading-relaxed text-slate-700">
                          Review and assess loan applications with advanced tools and insights
                        </p>
                        <ul className="mt-4 w-full space-y-2 text-base font-semibold text-slate-700">
                          <li className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-cyan-500" />
                            Review loan applications
                          </li>
                          <li className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-cyan-500" />
                            Perform comprehensive risk assessments
                          </li>
                          <li className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-cyan-500" />
                            Generate detailed analytical reports
                          </li>
                          <li className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-cyan-500" />
                            Approve or reject loan requests
                          </li>
                        </ul>
                        <Button className={`mt-6 w-full ${primaryButtonClass}`} size="lg">
                          Sign Up as Analyst
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                </div>

                <div className="mt-8 space-y-3 text-center">
                  <p className="text-base font-semibold text-slate-700">
                    Already have an account?{" "}
                    <button onClick={() => navigate("/auth")} className="font-extrabold text-cyan-700 hover:underline">
                      Sign In
                    </button>
                  </p>
                  <p className="text-sm font-medium text-slate-500">
                    By signing up, you agree to our Terms of Service and Privacy Policy
                  </p>
                </div>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className="mx-auto max-w-2xl rounded-3xl border border-cyan-200 bg-[linear-gradient(145deg,#ffffff_0%,#f0fdff_100%)] p-6 shadow-[0_22px_60px_rgba(8,145,178,0.14)] sm:p-8"
              >
                <div className="mb-6 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {selectedRole === "analyst" ? (
                      <>
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300 to-teal-400">
                          <ShieldCheck className="h-6 w-6 text-slate-950" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-slate-950">Credit Analyst</h3>
                          <p className="text-sm text-slate-500">Professional Account</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-50 ring-1 ring-cyan-100">
                          <User className="h-6 w-6 text-cyan-600" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-slate-950">Loan Applicant</h3>
                          <p className="text-sm text-slate-500">Personal Account</p>
                        </div>
                      </>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedRole(null)}
                    className="text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800"
                  >
                    Change Role
                  </Button>
                </div>

                <form onSubmit={handleSignup} className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-800">Full Name *</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-600" />
                      <Input
                        type="text"
                        name="fullName"
                        placeholder="Enter your full name"
                        value={formData.fullName}
                        onChange={handleChange}
                        className={inputClass}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-800">Email Address *</label>
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
                    <label className="text-sm font-semibold text-slate-800">Phone Number (Optional)</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-600" />
                      <Input
                        type="tel"
                        name="phone"
                        placeholder="Enter your phone number"
                        value={formData.phone}
                        onChange={handleChange}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-800">Password *</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-600" />
                      <Input
                        type={showPassword ? "text" : "password"}
                        name="password"
                        placeholder="Create a password"
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
                    <p className="text-xs text-slate-500">Must be at least 6 characters long</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-800">Confirm Password *</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-600" />
                      <Input
                        type={showConfirmPassword ? "text" : "password"}
                        name="confirmPassword"
                        placeholder="Confirm your password"
                        value={formData.confirmPassword}
                        onChange={handleChange}
                        className={`${inputClass} pr-10`}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-cyan-700"
                      >
                        {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <Button type="submit" className={`w-full ${primaryButtonClass}`} disabled={loading} size="lg">
                    {loading ? (
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-slate-950" />
                        Creating Account...
                      </div>
                    ) : (
                      `Create ${selectedRole === "analyst" ? "Analyst" : "Applicant"} Account`
                    )}
                  </Button>
                </form>

                <div className="mt-6 text-center">
                  <p className="text-sm text-slate-600">
                    Already have an account?{" "}
                    <button onClick={() => navigate("/auth")} className="font-semibold text-cyan-700 hover:underline">
                      Sign In
                    </button>
                  </p>
                </div>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default SignupPage;
