import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Seeds an admin (from ADMIN_EMAILS) and two sample reps with availability,
// so you can click around immediately. Safe to re-run.
async function main() {
  const adminEmail =
    (process.env.ADMIN_EMAILS || "").split(",")[0]?.trim().toLowerCase() ||
    "admin@example.com";

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: "ADMIN" },
    create: { email: adminEmail, name: "Admin", role: "ADMIN" },
  });

  const reps = [
    { email: "rep.a@example.com", name: "Rep A", weeklyCap: 10 },
    { email: "rep.b@example.com", name: "Rep B", weeklyCap: 8 },
  ];

  // Mon–Fri 9:00–17:00 for everyone (dayOfWeek 1..5).
  const weekdayWindows = [1, 2, 3, 4, 5].map((d) => ({
    dayOfWeek: d,
    startMin: 9 * 60,
    endMin: 17 * 60,
  }));

  for (const r of reps) {
    const rep = await prisma.user.upsert({
      where: { email: r.email },
      update: { name: r.name, weeklyCap: r.weeklyCap, role: "REP", active: true },
      create: { email: r.email, name: r.name, weeklyCap: r.weeklyCap, role: "REP" },
    });
    await prisma.availability.deleteMany({ where: { repId: rep.id } });
    await prisma.availability.createMany({
      data: weekdayWindows.map((w) => ({ repId: rep.id, ...w })),
    });
  }

  console.log(`Seeded admin (${adminEmail}) + ${reps.length} sample reps.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
