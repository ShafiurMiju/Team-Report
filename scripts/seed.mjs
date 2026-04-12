import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';

const uri = process.env.DATABASE_URL;

if (!uri) {
  throw new Error('DATABASE_URL is required for seeding');
}

const client = new MongoClient(uri);

async function main() {
  await client.connect();
  const dbName = process.env.DATABASE_NAME;
  const db = dbName ? client.db(dbName) : client.db();

  console.log('🌱 Seeding MongoDB...');

  const users = db.collection('users');
  const projects = db.collection('projects');
  const tasks = db.collection('tasks');

  await Promise.all([
    users.deleteMany({}),
    projects.deleteMany({}),
    tasks.deleteMany({}),
  ]);

  await users.createIndex({ email: 1 }, { unique: true });

  const adminPassword = await bcrypt.hash('password123', 10);
  const leaderPassword = await bcrypt.hash('password123', 10);
  const memberPassword = await bcrypt.hash('password123', 10);
  const now = new Date();

  const adminResult = await users.insertOne({
    name: 'System Admin',
    email: 'admin@team.com',
    password: adminPassword,
    role: 'admin',
    createdAt: now,
    updatedAt: now,
  });

  console.log('✅ Admin created: admin@team.com / password123');

  const leaderResult = await users.insertOne({
    name: 'Team Leader 1',
    email: 'leader@team.com',
    password: leaderPassword,
    role: 'leader',
    createdAt: now,
    updatedAt: now,
  });

  const leader2Result = await users.insertOne({
    name: 'Team Leader 2',
    email: 'leader2@team.com',
    password: leaderPassword,
    role: 'leader',
    createdAt: now,
    updatedAt: now,
  });

  console.log('✅ Leaders created: leader@team.com, leader2@team.com / password123');

  const memberDocs = [
    { name: 'Miju', email: 'miju@team.com', password: memberPassword, role: 'member', leaderId: leaderResult.insertedId, createdAt: now, updatedAt: now },
    { name: 'Parvez', email: 'parvez@team.com', password: memberPassword, role: 'member', leaderId: leaderResult.insertedId, createdAt: now, updatedAt: now },
    { name: 'Jony', email: 'jony@team.com', password: memberPassword, role: 'member', leaderId: leader2Result.insertedId, createdAt: now, updatedAt: now },
    { name: 'Atik', email: 'atik@team.com', password: memberPassword, role: 'member', leaderId: leader2Result.insertedId, createdAt: now, updatedAt: now },
  ];

  const memberResult = await users.insertMany(memberDocs);
  const memberIds = Object.values(memberResult.insertedIds);

  console.log('✅ Sample members created (password: password123 for all)');

  const projectDocs = [
    {
      name: 'NuPath',
      emoji: '🔷',
      leaderIds: [leaderResult.insertedId],
      createdAt: now,
      updatedAt: now,
    },
    {
      name: 'DCN',
      emoji: '🔷',
      leaderIds: [leaderResult.insertedId, leader2Result.insertedId],
      createdAt: now,
      updatedAt: now,
    },
    {
      name: 'DCN-AI',
      emoji: '🔷',
      leaderIds: [leader2Result.insertedId],
      createdAt: now,
      updatedAt: now,
    },
  ];

  const projectResult = await projects.insertMany(projectDocs);
  const projectIds = Object.values(projectResult.insertedIds);

  console.log('✅ Sample projects created');

  const [mijuId, parvezId, jonyId, atikId] = memberIds;
  const [nupathId, dcnId] = projectIds;

  const sampleTasks = [
    { title: 'Improve login & registration screens', status: 'done', userId: mijuId, projectId: nupathId },
    { title: 'Create reusable components', status: 'todo', userId: mijuId, projectId: nupathId },
    { title: 'Implement change password feature', status: 'in-progress', userId: mijuId, projectId: nupathId },
    { title: 'Migrate Firebase function to Express', status: 'done', userId: mijuId, projectId: nupathId },

    { title: 'Review app to find where Firebase is used', status: 'done', userId: parvezId, projectId: nupathId },
    { title: 'Add backend API base URL and config', status: 'done', userId: parvezId, projectId: nupathId },
    { title: 'Replace Firebase data reads/writes with backend API calls', status: 'done', userId: parvezId, projectId: nupathId },

    { title: 'Work on Handle Request Cancellation on Document Type Archive', status: 'todo', userId: jonyId, projectId: dcnId },
    { title: 'Work on Archive Uploaded Documents on Document Type Archive', status: 'done', userId: jonyId, projectId: dcnId },
    { title: 'Work on document status cancellation after library and facility archive', status: 'in-progress', userId: jonyId, projectId: dcnId },

    { title: 'Review all reported bugs and error logs', status: 'done', userId: atikId, projectId: dcnId },
    { title: 'Solving error msg showing multiple Times', status: 'done', userId: atikId, projectId: dcnId },
    { title: 'Working on DCN issues', status: 'done', userId: atikId, projectId: dcnId },
    { title: 'Upgrading Milestone-3', status: 'in-progress', userId: atikId, projectId: dcnId },
  ].map((task) => ({
    ...task,
    date: now,
    createdAt: now,
    updatedAt: now,
  }));

  await tasks.insertMany(sampleTasks);

  console.log('✅ Sample tasks created');
  console.log('\n🎉 Seed complete! You can now log in:');
  console.log('   Admin:   admin@team.com / password123');
  console.log('   Leader:  leader@team.com / password123');
  console.log('   Leader:  leader2@team.com / password123');
  console.log('   Members: miju@team.com, parvez@team.com, jony@team.com, atik@team.com (all use password123)');
  console.log(`   Admin id: ${adminResult.insertedId}`);
  console.log(`   Leader id: ${leaderResult.insertedId}`);
  console.log(`   Leader2 id: ${leader2Result.insertedId}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await client.close();
  });
