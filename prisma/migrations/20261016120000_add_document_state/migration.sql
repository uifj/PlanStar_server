-- CreateTable
CREATE TABLE "DocumentState" (
    "objectId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentState_pkey" PRIMARY KEY ("objectId")
);

-- AddForeignKey
ALTER TABLE "DocumentState" ADD CONSTRAINT "DocumentState_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "Obj"("id") ON DELETE CASCADE ON UPDATE CASCADE;
