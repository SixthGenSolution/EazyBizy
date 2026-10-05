import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const MotionLink = motion(Link);

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const navLinks = [
    { name: "Home", href: "/" },
    { name: "Loan Schemes", href: "/loan-schemes" },
    { name: "Features", href: "/features" },
    { name: "How It Works", href: "/how-it-works" },
    { name: "Dashboard", href: "/dashboard" },
        { name: "Learning", href: "/learning" },
        { name: "Contact", href: "/contact" },
        { name: "FAQs", href: "/faq" },
    
  ];

  const handleDashboardClick = async () => {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      console.error("Navbar auth check failed:", error);
    }

    setIsOpen(false);
    navigate(data.user ? "/dashboard" : "/login");
  };

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="fixed top-0 left-0 right-0 z-50 glass"
    >
      <div className="container mx-auto px-4 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-3 sm:h-20">
          {/* Logo */}
          <MotionLink
            to="/"
            whileHover={{ scale: 1.05 }}
            className="flex items-center gap-3"
          >
            <div className="flex flex-col items-center text-center">
              <div className="h-9 w-9 overflow-hidden rounded-xl shadow-lg shadow-cyan-500/20 gradient-primary sm:h-10 sm:w-10">
                <img src="/logo.png" alt="EazyBizy logo" className="w-full h-full object-cover" />
              </div>
              <span className="mt-1 text-xs font-bold tracking-tight text-foreground sm:text-sm">
                EazyBizy
              </span>
            </div>
          </MotionLink>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-8">
            {navLinks.map((link) =>
              link.name === "Dashboard" ? (
                <motion.div key={link.name} whileHover={{ y: -2 }}>
                  <button
                    type="button"
                    onClick={handleDashboardClick}
                    className="font-semibold text-foreground/80 transition-colors duration-300 hover:text-primary"
                  >
                    {link.name}
                  </button>
                </motion.div>
              ) : link.href.startsWith("/") ? (
                <motion.div key={link.name} whileHover={{ y: -2 }}>
                  <Link
                    to={link.href}
                    className="text-foreground/80 hover:text-primary transition-colors duration-300 font-semibold"
                  >
                    {link.name}
                  </Link>
                </motion.div>
              ) : (
                <motion.a
                  key={link.name}
                  href={link.href}
                  whileHover={{ y: -2 }}
                  className="text-foreground/80 hover:text-primary transition-colors duration-300 font-semibold"
                >
                  {link.name}
                </motion.a>
              ),
            )}
          </div>

          {/* CTA Buttons */}
          <div className="hidden lg:flex items-center gap-4">
            <Button
              size="sm"
              className="gradient-gold rounded-full px-5 py-2 text-[#0B0F1A] font-semibold shadow-[0_10px_26px_rgba(14,165,233,0.30)] transition duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              asChild
            >
              <Link to="/login">Login</Link>
            </Button>
            <Button 
              size="default" 
              className="gradient-gold hover:opacity-90 text-[#0B0F1A] font-bold shadow-[0_10px_26px_rgba(14,165,233,0.30)] transition-opacity duration-200"
              asChild
            >
              <Link to="/signup">Apply Now</Link>
            </Button>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="rounded-xl p-2 text-foreground transition hover:bg-white/5"
              aria-label="Toggle navigation menu"
              aria-expanded={isOpen}
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <Button
              size="sm"
              className="hidden rounded-full px-4 py-2 font-bold text-[#0B0F1A] shadow-[0_10px_24px_rgba(14,165,233,0.26)] transition duration-200 hover:opacity-90 gradient-gold sm:inline-flex"
              asChild
            >
              <Link to="/signup">Apply Now</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden glass border-t border-border"
          >
            <div className="container mx-auto flex max-h-[calc(100vh-4rem)] flex-col gap-3 overflow-y-auto px-4 py-4 sm:gap-4 sm:py-6">
              {navLinks.map((link) =>
                link.name === "Dashboard" ? (
                  <button
                    key={link.name}
                    type="button"
                    className="py-2 text-left font-semibold text-foreground/80 transition-colors hover:text-primary"
                    onClick={handleDashboardClick}
                  >
                    {link.name}
                  </button>
                ) : link.href.startsWith("/") ? (
                  <Link
                    key={link.name}
                    to={link.href}
                    className="text-foreground/80 hover:text-primary transition-colors py-2 font-semibold"
                    onClick={() => setIsOpen(false)}
                  >
                    {link.name}
                  </Link>
                ) : (
                  <a
                    key={link.name}
                    href={link.href}
                    className="text-foreground/80 hover:text-primary transition-colors py-2 font-semibold"
                    onClick={() => setIsOpen(false)}
                  >
                    {link.name}
                  </a>
                ),
              )}
              <div className="flex flex-col gap-3 pt-4 border-t border-border">
                <Button
                  className="rounded-full gradient-gold px-4 py-2 text-[#0B0F1A] font-semibold shadow-[0_10px_24px_rgba(14,165,233,0.26)] transition duration-200 hover:opacity-90"
                  asChild
                >
                  <Link to="/login">Login</Link>
                </Button>
                <Button 
                  className="rounded-full gradient-gold px-4 py-2 text-[#0B0F1A] font-semibold shadow-[0_10px_24px_rgba(14,165,233,0.26)] transition duration-200 hover:opacity-90"
                  asChild
                >
                  <Link to="/signup">Apply Now</Link>
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
};

export default Navbar;
