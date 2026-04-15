import { Card, CardContent } from "@/components/ui/card";
import { Globe, Gauge, BarChart3, Shield, Zap, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth";
import { useTranslation } from "react-i18next";

export function Dashboard() {
  const { t } = useTranslation();
  const { openAuthModal } = useAuthStore();

  const features = [
    {
      icon: Globe,
      title: t('dashboard.featureMultiChannel'),
      description: t('dashboard.featureMultiChannelDesc'),
      gradient: "from-blue-500/10 to-cyan-500/10",
      iconBg: "from-blue-500 to-cyan-500",
      delay: "0ms",
    },
    {
      icon: Gauge,
      title: t('dashboard.featureLoadBalance'),
      description: t('dashboard.featureLoadBalanceDesc'),
      gradient: "from-emerald-500/10 to-teal-500/10",
      iconBg: "from-emerald-500 to-teal-500",
      delay: "50ms",
    },
    {
      icon: BarChart3,
      title: t('dashboard.featureUsageTracking'),
      description: t('dashboard.featureUsageTrackingDesc'),
      gradient: "from-amber-500/10 to-orange-500/10",
      iconBg: "from-amber-500 to-orange-500",
      delay: "100ms",
    },
    {
      icon: Shield,
      title: t('dashboard.featureSecurity'),
      description: t('dashboard.featureSecurityDesc'),
      gradient: "from-violet-500/10 to-purple-500/10",
      iconBg: "from-violet-500 to-purple-500",
      delay: "150ms",
    },
  ];

  const steps = [
    { num: "01", title: t('dashboard.step1Title'), desc: t('dashboard.step1Desc'), color: "text-blue-500" },
    { num: "02", title: t('dashboard.step2Title'), desc: t('dashboard.step2Desc'), color: "text-emerald-500" },
    { num: "03", title: t('dashboard.step3Title'), desc: t('dashboard.step3Desc'), color: "text-amber-500" },
    { num: "04", title: t('dashboard.step4Title'), desc: t('dashboard.step4Desc'), color: "text-violet-500" },
  ];

  return (
    <div className="animate-in">
      {/* Hero Section */}
      <div className="relative">
        <div className="px-4 md:px-6 lg:px-8 py-12 md:py-16 lg:py-20">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/8 border border-primary/10 text-primary text-sm font-medium mb-6">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{t('dashboard.tagline')}</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-[3.5rem] font-bold tracking-tight leading-[1.1] mb-5">
              <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/70 bg-clip-text text-transparent">
                {t('dashboard.heroTitle')}
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-8 max-w-2xl whitespace-pre-line">
              {t('dashboard.heroDescription')}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={openAuthModal}
                className="h-12 px-6 text-[15px] shadow-lg shadow-primary/20"
              >
                {t('auth.adminLogin')}
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-100 h-100 bg-teal-300/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-48 h-48 bg-blue-300/20 rounded-full blur-3xl pointer-events-none" />
      </div>

      <div className="px-4 md:px-6 lg:px-8 pb-8 space-y-10">
        {/* Features Grid */}
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
            {features.map((feature) => (
              <Card
                key={feature.title}
                className="group hover-lift border-0 bg-gradient-to-br from-card to-card overflow-hidden"
              >
                <CardContent className="p-6 relative">
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
                  />
                  <div className="relative">
                    <div
                      className={`w-11 h-11 rounded-xl bg-gradient-to-br ${feature.iconBg} flex items-center justify-center mb-4 shadow-lg`}
                    >
                      <feature.icon className="h-5 w-5 text-white" />
                    </div>
                    <h3 className="font-semibold mb-1.5 text-[15px]">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Quick Start */}
        <Card className="border-0">
          <CardContent className="py-6">
            <div className="pb-4">
              <h2 className="text-lg font-semibold mb-1">{t('dashboard.quickStart')}</h2>
              <p className="text-sm text-muted-foreground">{t('dashboard.quickStartDesc')}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {steps.map((step) => (
                <div key={step.num} className="group">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <span
                        className={`text-2xl font-bold ${step.color} opacity-60 group-hover:opacity-100 transition-opacity`}
                      >
                        {step.num}
                      </span>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-1 text-sm">{step.title}</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Supported Providers */}
        <div className="text-center py-4">
          <p className="text-xs text-muted-foreground/60 uppercase tracking-wider mb-4">{t('dashboard.supportedEndpoints')}</p>
          <div className="flex items-center justify-center gap-6 flex-wrap text-muted-foreground/40">
            {["OpenAI", "OpenAI Responses", "Claude", "Gemini", "Azure OpenAI"].map((name) => (
              <div
                key={name}
                className="flex items-center gap-2 text-sm font-medium hover:text-muted-foreground transition-colors"
              >
                <Zap className="h-3.5 w-3.5" />
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
