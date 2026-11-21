const db = require('../config/db');

async function seed() {
  try {
    await db.query(
      `UPDATE client_brand_guidelines
       SET official_logo_brand_name = ?,
           required_brand_tokens = ?,
           tagline_policy = ?,
           tagline_text = ?,
           logo_config_updated_at = NOW()
       WHERE client_id = ?`,
      [
        'DOAGURU INFOSYSTEMS',
        JSON.stringify(['DOAGURU', 'INFOSYSTEMS']),
        'OPTIONAL',
        'Transforming Technically',
        11,
      ]
    );

    await db.query(
      `UPDATE client_brand_guidelines
       SET official_logo_brand_name = ?,
           required_brand_tokens = ?,
           tagline_policy = ?,
           tagline_text = ?,
           logo_config_updated_at = NOW()
       WHERE client_id = ?`,
      [
        "BALGOPAL CHILDREN'S NEURO CLINIC AND DEVELOPMENT CENTRE",
        JSON.stringify(["BALGOPAL", "CHILDREN'S", "NEURO", "CLINIC", "DEVELOPMENT", "CENTRE"]),
        'NONE',
        null,
        1,
      ]
    );

    await db.query(
      `UPDATE client_brand_guidelines
       SET official_logo_brand_name = ?,
           required_brand_tokens = ?,
           tagline_policy = ?,
           tagline_text = ?,
           logo_config_updated_at = NOW()
       WHERE client_id = ?`,
      [
        'NAVJYOTI EYE HOSPITAL',
        JSON.stringify(['NAVJYOTI', 'EYE', 'HOSPITAL']),
        'NONE',
        null,
        15,
      ]
    );

    const [rows] = await db.query(
      'SELECT client_id, official_logo_brand_name, required_brand_tokens, tagline_policy, tagline_text FROM client_brand_guidelines WHERE client_id IN (1, 11, 15)'
    );
    console.log('Successfully seeded client logo configurations:');
    console.table(rows);
    process.exit(0);
  } catch (err) {
    console.error('Error seeding logo configs:', err);
    process.exit(1);
  }
}

seed();
