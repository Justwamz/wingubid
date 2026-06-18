-- Remove em dashes from seeded banner headlines
UPDATE banners
SET headline = '🎉 Register Free. Start with KES 10,000'
WHERE placement = 'landing' AND headline = '🎉 Register Free — Start with KES 10,000';

UPDATE banners
SET headline = '💰 Deposit and Play. Double Your First Top-Up'
WHERE placement = 'lobby' AND headline = '💰 Deposit & Play — Double Your First Top-Up';
