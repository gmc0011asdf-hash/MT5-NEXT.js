import { SignIn } from "@clerk/nextjs";

const clerkAppearance = {
  elements: {
    cardBox: "shadow-2xl border border-white/10",
    card: "bg-background text-foreground",
    headerTitle: "text-xl font-bold",
    headerSubtitle: "text-muted-foreground",
    footer: "hidden",
    footerAction: "hidden",
    logoBox: "hidden",
  },
};

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6" dir="rtl">
      <section className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">
            نظام الملك الهندسي للتداول العالمي
          </h1>
          <p className="text-sm text-muted-foreground">
            تسجيل الدخول إلى لوحة التحكم المؤسسية
          </p>
        </div>

        <div dir="ltr">
          <SignIn
            appearance={clerkAppearance}
            routing="path"
            path="/sign-in"
            signUpUrl="/sign-up"
            fallbackRedirectUrl="/dashboard"
          />
        </div>
      </section>
    </main>
  );
}
