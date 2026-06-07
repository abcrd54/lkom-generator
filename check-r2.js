const { S3Client, ListObjectsV2Command, HeadObjectCommand } = require("@aws-sdk/client-s3");

const r2Client = new S3Client({
  region: "auto",
  endpoint: "https://cb3bc45781370a6fe6edb1fe8bd6b74d.r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: "c7325d38b38ee41cab13021abbfe7494",
    secretAccessKey: "95dbacede41f4a4ff44f4a4ca33e659acda9da790c60954ba38c9f3179ae01f2",
  },
});

(async () => {
  // List reference files
  const listCmd = new ListObjectsV2Command({
    Bucket: "lkom",
    Prefix: "references/",
    MaxKeys: 10,
  });
  const listResult = await r2Client.send(listCmd);
  console.log("Files in references/:");
  if (listResult.Contents) {
    for (const obj of listResult.Contents) {
      console.log(`  ${obj.Key} (${obj.Size} bytes, ${obj.LastModified})`);
    }
  }

  // Check specific file
  const key = "references/5307d224-215d-4065-8386-e3417a74fc1a/23da6414-8d5e-4800-bb7f-7e4429bd688f-0.jpg";
  try {
    const headCmd = new HeadObjectCommand({ Bucket: "lkom", Key: key });
    const headResult = await r2Client.send(headCmd);
    console.log(`\nFile ${key}:`);
    console.log(`  ContentType: ${headResult.ContentType}`);
    console.log(`  ContentLength: ${headResult.ContentLength}`);
    console.log(`  LastModified: ${headResult.LastModified}`);
  } catch (err) {
    console.log(`\nFile ${key}: NOT FOUND (${err.name})`);
  }
})();
