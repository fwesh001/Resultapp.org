#!/bin/bash
echo "=== vhs school admin credential state ==="
sudo -u postgres psql -d postgres -tAc \
  "SELECT subdomain,
          CASE WHEN admin_password_hash IS NULL OR admin_password_hash = '' THEN 'NO PASSWORD SET' ELSE 'password set' END
   FROM schools WHERE subdomain='vhs';"

echo
echo "=== temporarily set a known admin password for layout verification ==="
sudo -u postgres psql -d postgres -q -c \
  "UPDATE schools SET admin_password_hash = crypt('layoutadmin123', gen_salt('bf')) WHERE subdomain='vhs';"
sudo -u postgres psql -d postgres -tAc \
  "SELECT email FROM schools WHERE subdomain='vhs';" | sed 's/^/  admin email: /'

echo
echo "=== staff roster (for the Moderator Management UI check) ==="
sudo -u postgres psql -d postgres -tAc \
  "SELECT staff_id || ' | ' || full_name || ' | ' || role || ' | mod=' || coalesce(is_moderator::text,'null')
   FROM tenant_staff WHERE subdomain='vhs' ORDER BY staff_id LIMIT 12;"