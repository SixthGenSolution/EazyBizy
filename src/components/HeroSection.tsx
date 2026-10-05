import { motion } from "framer-motion";
import CountUp from "react-countup";
import {
  ArrowRight,
  CheckCircle2,
  Star,
  Building2,
  FileCheck,
  IndianRupee,
  UserRound,
  BriefcaseBusiness,
  FileText,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const HeroSection = () => {
  const benefits = [
    "MUDRA, PMEGP & MSME Schemes",
    "Auto-generated Bank Reports",
    "100% Digital Application",
  ];

  const stats = [
    { icon: Building2, label: "MSME Loans", end: 50, prefix: "", suffix: "K+" },
    { icon: FileCheck, label: "Success Rate", end: 94, prefix: "", suffix: "%" },
    { icon: IndianRupee, label: "Disbursed", end: 500, prefix: "₹", suffix: "Cr+" },
  ];

  const previewSteps = [
    { step: 1, name: "Personal Info", icon: UserRound, active: true },
    { step: 2, name: "Business Info", icon: BriefcaseBusiness, active: false },
    { step: 3, name: "Loan Details", icon: FileText, active: false },
    { step: 4, name: "Preview", icon: Eye, active: false },
  ];

  return (
    <section className="relative min-h-screen gradient-hero overflow-hidden pt-20">
      {/* Modern Background Effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 gradient-glow animate-pulse-glow rounded-full blur-3xl opacity-35" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 gradient-glow animate-pulse-glow rounded-full blur-3xl opacity-30" style={{ animationDelay: "1.5s" }} />
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full h-full bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
      
      <div className="container mx-auto px-4 lg:px-8 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center min-h-[calc(100vh-80px)]">
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="flex flex-col gap-8"
          >
            {/* Badge - Dark theme style */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 w-fit bg-card/90 border border-border/80"
            >
              <Star className="w-4 h-4 text-primary fill-primary" />
              <span className="text-sm text-foreground font-medium">Government Loan Assistance Platform</span>
            </motion.div>

            {/* Headline - More modern styling */}
            <div className="flex flex-col gap-4">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight">
                MSME Loans
                <br />
                <span className="text-primary">Made Simple</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
                Apply for MUDRA, PMEGP & MSME loans with our digital platform. 
                Auto-generate bank-ready project reports and get approved faster.
              </p>
            </div>

            {/* Benefits - Dark theme enhanced design */}
            <div className="flex flex-col gap-3">
              {benefits.map((benefit, index) => (
                <motion.div
                  key={benefit}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + index * 0.1 }}
                  className="flex items-center gap-3 bg-card/95 rounded-xl p-3 border border-border/80"
                >
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-foreground font-medium">{benefit}</span>
                </motion.div>
              ))}
            </div>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="flex flex-col sm:flex-row gap-4"
            >
              <Button 
                size="lg" 
                className="group gradient-gold hover:opacity-90 text-[#0B0F1A] font-bold shadow-[0_12px_28px_rgba(14,165,233,0.32)] transition-opacity duration-200"
                asChild
              >
                  <Link to="/signup" className="text-white">
                  Start Application
                  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button 
                variant="outline" 
                size="lg" 
                className="border border-primary/40 bg-transparent text-primary hover:bg-primary/10 hover:border-primary/70 font-semibold transition-all duration-200"
                asChild
              >
                <a href="#loans">View Schemes</a>
              </Button>
            </motion.div>

            {/* Stats - Dark theme modernized */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 }}
              className="flex items-center gap-8 pt-4"
            >
              {stats.map((stat, i) => (
                <div key={i} className="text-center">
                  <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center mx-auto mb-2">
                    <stat.icon className="w-5 h-5 text-primary" />
                  </div>
                  <motion.p
                    initial={{ rotateX: 90, opacity: 0 }}
                    animate={{ rotateX: 0, opacity: 1 }}
                    transition={{ duration: 0.55, delay: 1.0 + i * 0.15 }}
                    style={{ transformPerspective: 600 }}
                    className="text-xl font-bold text-foreground"
                  >
                    {stat.prefix}
                    <CountUp start={0} end={stat.end} duration={2.5} suffix={stat.suffix} delay={0.8} />
                  </motion.p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </motion.div>
          </motion.div>

          {/* Right Content - Form Preview with Dark Theme */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="relative flex justify-center lg:justify-end"
          >
            <div className="relative">
              {/* Enhanced glow effect with teal */}
              <div className="absolute inset-0 bg-primary/15 animate-pulse-glow blur-3xl scale-110 opacity-35" />
              
              {/* Application Preview Card - Dark theme */}
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="relative w-80 md:w-96 rounded-[2rem] bg-card border border-primary/20 shadow-card overflow-hidden backdrop-blur-sm shadow-[0_0_60px_hsl(174_66%_51%/0.12)]"
              >
                {/* Card Header with dark gradient */}
                <div className="p-6 border-b border-border bg-gradient-to-r from-primary/8 to-transparent">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl gradient-primary overflow-hidden shadow-button">
                      <img src="/logo.png" alt="EazyBizy logo" className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <p className="text-foreground font-semibold text-lg">EazyBizy Application</p>
                      <p className="text-muted-foreground text-sm">10-Step Digital Form</p>
                    </div>
                  </div>
                </div>
                
                {/* Card Content */}
                <div className="p-6 space-y-4">
                  {/* Progress with teal accent */}
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground font-medium">Progress</span>
                      <span className="text-primary font-semibold">Step 1 of 10</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full gradient-primary rounded-full shadow-sm" style={{ width: "10%" }} />
                    </div>
                  </div>

                  {/* Form Steps Preview with dark design */}
                  <div className="space-y-3">
                    {previewSteps.map((item) => (
                      <div
                        key={item.step}
                        className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-300 ${
                          item.active 
                            ? "bg-primary/10 border border-primary/35"
                            : "bg-muted/35 hover:bg-muted/55"
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          item.active ? "bg-primary/20" : "bg-background/50"
                        }`}>
                          <item.icon
                            className={`w-4 h-4 ${item.active ? "text-primary" : "text-muted-foreground"}`}
                          />
                        </div>
                        <span className={`flex-1 ${
                          item.active ? "text-foreground font-semibold" : "text-muted-foreground font-medium"
                        }`}>
                          {item.name}
                        </span>
                        {item.active && (
                          <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-glow" />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* CTA button */}
                  <div className="pt-2">
                    <div
                      className="gradient-gold hover:opacity-90 rounded-xl py-3.5 text-center cursor-pointer transition-all duration-200 shadow-[0_10px_28px_rgba(14,165,233,0.30)]"
                      onClick={() => window.location.href = '/signup'}
                    >
                      <span className="font-bold text-[#0B0F1A]">Continue Application -&gt;</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Bottom Wave with dark color */}
      <div className="absolute bottom-0 left-0 right-0">
        <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
          <path
            d="M0 120L60 110C120 100 240 80 360 70C480 60 600 60 720 65C840 70 960 80 1080 85C1200 90 1320 90 1380 90L1440 90V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0Z"
            fill="hsl(var(--card))"
          />
        </svg>
      </div>
    </section>
  );
};

export default HeroSection;

