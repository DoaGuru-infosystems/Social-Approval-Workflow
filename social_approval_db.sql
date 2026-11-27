-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Nov 20, 2026 at 02:06 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `social_approval_db`
--

-- --------------------------------------------------------

--
-- Table structure for table `ai_check_results`
--

CREATE TABLE `ai_check_results` (
  `id` int(11) NOT NULL,
  `post_id` int(11) NOT NULL,
  `revision_id` int(11) DEFAULT NULL,
  `spelling_issues` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`spelling_issues`)),
  `grammar_suggestions` longtext DEFAULT NULL,
  `key_error` longtext DEFAULT NULL,
  `ocr_extracted_text` text DEFAULT NULL,
  `ocr_issues` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`ocr_issues`)),
  `banned_words_found` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`banned_words_found`)),
  `missing_mandatory_phrases` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`missing_mandatory_phrases`)),
  `brand_identity_check` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`brand_identity_check`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `ocr_confidence` decimal(5,2) DEFAULT NULL,
  `ocr_unreliable` tinyint(1) NOT NULL DEFAULT 0,
  `image_status` varchar(20) NOT NULL DEFAULT 'completed',
  `text_status` varchar(20) NOT NULL DEFAULT 'completed',
  `image_error` text DEFAULT NULL,
  `logo_check` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`logo_check`)),
  `ai_provider` varchar(20) DEFAULT 'gemini',
  `fallback_used` tinyint(1) DEFAULT 0,
  `fallback_reason` varchar(50) DEFAULT 'none',
  `enforcement_state` varchar(50) DEFAULT 'green_clean'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `ai_check_results`
--

INSERT INTO `ai_check_results` (`id`, `post_id`, `revision_id`, `spelling_issues`, `grammar_suggestions`, `key_error`, `ocr_extracted_text`, `ocr_issues`, `banned_words_found`, `missing_mandatory_phrases`, `brand_identity_check`, `created_at`, `ocr_confidence`, `ocr_unreliable`, `image_status`, `text_status`, `image_error`, `logo_check`, `ai_provider`, `fallback_used`, `fallback_reason`, `enforcement_state`) VALUES
(28, 15, 27, '[{\"word\":\"नःशुलक\",\"script\":\"hindi\",\"suggestion\":\"निःशुल्क\",\"suggestions\":[\"निःशुल्क\"],\"reason\":\"वर्तनी में सुधार: \'नःशुलक\' गलत है, सही शब्द \'निःशुल्क\' है।\",\"source\":\"image\"},{\"word\":\"नेऋ\",\"script\":\"hindi\",\"suggestion\":\"नेत्र\",\"suggestions\":[\"नेत्र\"],\"reason\":\"वर्तनी में सुधार: \'नेऋ\' गलत है, सही शब्द \'नेत्र\' है।\",\"source\":\"image\"},{\"word\":\"सजरी\",\"script\":\"hindi\",\"suggestion\":\"सर्जरी\",\"suggestions\":[\"सर्जरी\"],\"reason\":\"वर्तनी में सुधार: \'सजरी\' गलत है, सही शब्द \'सर्जरी\' है।\",\"source\":\"image\"},{\"word\":\"पयेक\",\"script\":\"hindi\",\"suggestion\":\"प्रत्येक\",\"suggestions\":[\"प्रत्येक\"],\"reason\":\"वर्तनी में सुधार: \'पयेक\' गलत है, सही शब्द \'प्रत्येक\' है।\",\"source\":\"image\"},{\"word\":\"नेऋिवशेषज\",\"script\":\"hindi\",\"suggestion\":\"नेत्रविशेषज्ञ\",\"suggestions\":[\"नेत्रविशेषज्ञ\"],\"reason\":\"वर्तनी में सुधार: \'नेऋिवशेषज\' गलत है, सही शब्द \'नेत्रविशेषज्ञ\' है।\",\"source\":\"image\"},{\"word\":\"सुरिभत\",\"script\":\"hindi\",\"suggestion\":\"सुरक्षित\",\"suggestions\":[\"सुरक्षित\"],\"reason\":\"वर्तनी में सुधार: \'सुरिभत\' गलत है, सही शब्द \'सुरक्षित\' है।\",\"source\":\"image\"},{\"word\":\"एवों\",\"script\":\"hindi\",\"suggestion\":\"एवं\",\"suggestions\":[\"एवं\"],\"reason\":\"वर्तनी में सुधार: \'एवों\' गलत है, सही शब्द \'एवं\' है।\",\"source\":\"image\"},{\"word\":\"वथसनीय\",\"script\":\"hindi\",\"suggestion\":\"विश्वसनीय\",\"suggestions\":[\"विश्वसनीय\"],\"reason\":\"वर्तनी में सुधार: \'वथसनीय\' गलत है, सही शब्द \'विश्वसनीय\' है।\",\"source\":\"image\"},{\"word\":\"सुंबह\",\"script\":\"hindi\",\"suggestion\":\"सुबह\",\"suggestions\":[\"सुबह\"],\"reason\":\"वर्तनी में सुधार: \'सुंबह\' गलत है, सही शब्द \'सुबह\' है।\",\"source\":\"image\"},{\"word\":\"असपताल\",\"script\":\"hindi\",\"suggestion\":\"अस्पताल\",\"suggestions\":[\"अस्पताल\"],\"reason\":\"वर्तनी में सुधार: \'असपताल\' गलत है, सही शब्द \'अस्पताल\' है।\",\"source\":\"image\"}]', '[]', '{\"service\":\"gemini_ai\",\"code\":20,\"user_message\":\"AI se check nahi hua, Python PaddleOCR se check kiya gaya (Warning: Hindi matra aur OCR text ki accuracy kam ho sakti hai, kripya poster manually verify karein).\"}', 'अब\nतक\n35,000+\nनःशुलक\nECRE FOR\nनेऋ\nNAVJYOTI\nसजरी\nमोित्यािबंद\nऑपरेशन\nपयेक\nफ\nमाह\n१२\nडॉ.\nआर.\nपी.\nवरकड़े\nFICO\nChitrakoot\nPeloe\nVisiting\nConsultant\nShankaracharya Netralaya\nJhoteshwar\nAnushree\nNetralaya.\nJabalpur\nEx-Consultant\nSadguru Netra.\nChikitsalaya.\nनेऋिवशेषज\nसुरिभत\nएवों\n/14\nवथसनीय\nसमय\nअभी\nअपॉइंटमेंट\nसुंबह\n11:0०\n3:0०\n6268875304\n8817232247\nके\nसामने\nरांझी,\nIEIPH\nम...\nडिष,\nबेहतरजीवन\nEYE\nआधुिनक\nबुक\nतारीखको\nअनुभव\nजबलपुर\n\'$/245/2?\nकी\n.एस.\nचौक,\n12 0512?\n1२\nअसपताल', '[{\"id\":1,\"section\":\"1. Region: 35,000+ अब तक h सजरी नेऋ ऑपरेशन ...\",\"rect\":{\"left\":4.14,\"top\":1.88,\"width\":90.39,\"height\":68.24},\"poster_expected\":\"35,000+ अब तक h सजरी नेऋ ऑपरेशन पयेक माह की १२ 1२ तारीखको फ डॉ. आर. पी. .एस. वरकड़े MBBS,MS, Visiting Consultant अनुभव Shankaracharya Netralaya Peloe FICO Chitrakoot Ex-Consultant Anushree Sadguru Netra. Sadवपrण Netralaya. Chikitsalaya. Jabalpur Jhoteshwar नेऋिवशेषज PEI६ सुरिभत /14 आधुिनक एवों वथसनीय PIPh12\",\"ocr_read\":\"35,000+ अब तक h सजरी नेऋ ऑपरेशन पयेक माह की १२ 1२ तारीखको फ डॉ. आर. पी. .एस. वरकड़े MBBS,MS, Visiting Consultant अनुभव Shankaracharya Netralaya Peloe FICO Chitrakoot Ex-Consultant Anushree Sadguru Netra. Sadवपrण Netralaya. Chikitsalaya. Jabalpur Jhoteshwar नेऋिवशेषज PEI६ सुरिभत /14 आधुिनक एवों वथसनीय PIPh12\",\"status\":\"red\",\"status_label\":\"RED = Real Error\",\"confidence\":91,\"reason\":\"Spelling error detected on poster: \\\"नेऋ\\\" (Did you mean: \\\"नेत्र\\\"?)\",\"region_type\":\"prose\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":2,\"section\":\"2. Region: NAVJYOTI ECRE FOR Y नःशुलक EYE म...\",\"rect\":{\"left\":2.19,\"top\":6.19,\"width\":65.39,\"height\":18.62},\"poster_expected\":\"Navjyoti Eye Hospital (Official Brand)\",\"ocr_read\":\"NAVJYOTI ECRE FOR Y नःशुलक EYE मोित्यािबंद\",\"status\":\"red\",\"status_label\":\"RED = Real Error\",\"confidence\":91,\"reason\":\"Spelling error detected on poster: \\\"नःशुलक\\\" (Did you mean: \\\"निःशुल्क\\\"?)\",\"region_type\":\"prose\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":3,\"section\":\"3. Region: बुक अभी अपॉइंटमेंट 3:0० 62688753...\",\"rect\":{\"left\":11.56,\"top\":77.5,\"width\":82.74,\"height\":22.32},\"poster_expected\":\"Contact: 6268875304\",\"ocr_read\":\"बुक अभी अपॉइंटमेंट 3:0० 6268875304 8817232247 Wh WIPh1? असपताल के सामने IEIPH चौक, रांझी, जबलपुर म... \'$/245/2? 12 0512? P6/a? डिष, बेहतरजीवन Pp/???\",\"status\":\"red\",\"status_label\":\"RED = Real Error\",\"confidence\":86,\"reason\":\"Spelling error detected on poster: \\\"असपताल\\\" (Did you mean: \\\"अस्पताल\\\"?)\",\"region_type\":\"prose\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":4,\"section\":\"4. Region: ३h/२ सुंबह 11:0० समय\",\"rect\":{\"left\":8.05,\"top\":77.94,\"width\":16.56,\"height\":9.18},\"poster_expected\":\"३h/२ सुंबह 11:0० समय\",\"ocr_read\":\"३h/२ सुंबह 11:0० समय\",\"status\":\"red\",\"status_label\":\"RED = Real Error\",\"confidence\":89,\"reason\":\"Spelling error detected on poster: \\\"सुंबह\\\" (Did you mean: \\\"सुबह\\\"?)\",\"region_type\":\"prose\",\"pattern_tags\":[],\"suspect_words\":[]}]', '[]', '[\"#NavjyotiEyeHospital\",\"#EyeCareJabalpur\",\"#CataractSurgeryJabalpur\"]', '{\"brand_name_correct\":false,\"brand_name_match_score\":55,\"matched_brand_text\":\"NAVJYOTI सजरी\",\"possible_brand_name_error\":\"Poster me brand name galat likha hai: \'NAVJYOTI सजरी\' vs official \'Navjyoti Eye Hospital\' (55% similarity < 95%). OCR ne sahi padha hai. Designer se theek karwao.\",\"phone_verification\":[{\"found_phone\":\"8817232247\",\"normalized_phone\":\"8817232247\",\"source\":\"caption\",\"edit_distance\":8,\"status\":\"unknown_phone\",\"message\":\"Unknown phone number mila jo registered numbers se match nahi karta: \'8817232247\' (caption)\"}],\"address_match_percentage\":9,\"address_warning\":null}', '2026-11-20 10:46:42', 89.40, 0, 'completed', 'completed', NULL, '{\"status\":\"PASS\",\"found\":true,\"score\":1,\"location\":\"top-left\",\"location_hindi\":\"Upar Left corner me\",\"size_percent\":15,\"reason\":\"CORRECT\",\"suggestion\":\"Logo top-left corner par bilkul theek jagah aur proper size mein placed hai.\",\"checked_by\":\"Gemini\"}', 'python', 1, 'gemini_failed', 'green_clean'),
(29, 15, 28, '[{\"word\":\"Healty\",\"script\":\"hindi\",\"suggestion\":\"Healthy\",\"suggestions\":[\"Healthy\"],\"reason\":\"यह अंग्रेजी शब्द \'Healthy\' की वर्तनी (spelling) में त्रुटि है।\",\"source\":\"image\"}]', '[]', '{\"service\":\"gemini_ai\",\"code\":20,\"user_message\":\"AI se check nahi hua, Python PaddleOCR se check kiya gaya (Warning: Hindi matra aur OCR text ki accuracy kam ho sakti hai, kripya poster manually verify karein).\"}', 'Over\n35,000+\nSuccessful\nFree\nNAVJYOTI\nEye Surgeries\nEVE Hospital\nCataract Surgery\nOn Every 12th of the Month.\nDr. Varkade\nMS, FICO (Chitrakoot)\nVisiting Consultant-Shankaracharya Netralaya,Jhoteshwar\nConsultant-Anushree Netralaya,Jabalpur\nEx-Consultant-Sadguru Netra Chikitsalaya,Chitrakoot\nExperienced\nEye Specialist\nSafe &Modern\nSurgery\nTrusted\nEye Hospital\nTiming\nBook Your Appointment Now.\n11:00 AM to\n3:00 PM\n6268875304,8817232247\nIn front of Pal Hospital, Mastana Chowk, Ranjhi, Jabalpur\nClear Vision, Healty Life', '[{\"id\":1,\"section\":\"1. Region: 35,000+ Over Eye Surgeries Succe...\",\"rect\":{\"left\":77.34,\"top\":1.43,\"width\":17.22,\"height\":11.9},\"poster_expected\":\"35,000+ Over Eye Surgeries Successful\",\"ocr_read\":\"35,000+ Over Eye Surgeries Successful\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":99,\"reason\":\"Verified OK against client whitelist/brand guidelines.\",\"region_type\":\"prose\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":2,\"section\":\"2. Region: NAVJYOTI EVE Hospital Free Catar...\",\"rect\":{\"left\":2.23,\"top\":9.41,\"width\":87.69,\"height\":60.72},\"poster_expected\":\"Navjyoti Eye Hospital (Official Brand)\",\"ocr_read\":\"NAVJYOTI EVE Hospital Free Cataract Surgery On Every 12th of the Month. Dr. R.P.S. Varkade MBBS, MS, FICO (Chitrakoot) Ex-Consultant-Sadguru Netra Chikitsalaya,Chitrakoot Visiting Consultant-Shankaracharya Netralaya,Jhoteshwar Consultant-Anushree Netralaya,Jabalpur Experienced Eye Specialist D Surgery Safe &Modern Eye Hospital Trusted\",\"status\":\"yellow\",\"status_label\":\"YELLOW = OCR Doubt\",\"confidence\":96,\"reason\":\"OCR Doubt: OCR Noise detected in token \'R.P.S.\' (unpronounceable_consonant_cluster (zero vowels in Latin token)). Unclear visual region on poster.\",\"region_type\":\"prose\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":3,\"section\":\"3. Region: 11:00 AM to Timing Book Your App...\",\"rect\":{\"left\":10.7,\"top\":77.48,\"width\":84.57,\"height\":21.45},\"poster_expected\":\"Contact: 6268875304\",\"ocr_read\":\"11:00 AM to Timing Book Your Appointment Now. 3:00 PM 6268875304,8817232247 In front of Pal Hospital, Mastana Chowk, Ranjhi, Jabalpur (M.P.) Clear Vision, Healty Life\",\"status\":\"red\",\"status_label\":\"RED = Real Error\",\"confidence\":97,\"reason\":\"Spelling error detected on poster: \\\"Healty\\\" (Did you mean: \\\"Healthy\\\"?)\",\"region_type\":\"prose\",\"pattern_tags\":[],\"suspect_words\":[]}]', '[]', '[\"#NavjyotiEyeHospital\",\"#EyeCareJabalpur\",\"#CataractSurgeryJabalpur\"]', '{\"brand_name_correct\":false,\"brand_name_match_score\":75,\"matched_brand_text\":\"NAVJYOTI Eye Surgeries EVE Hospital\",\"possible_brand_name_error\":\"Poster me brand name galat likha hai: \'NAVJYOTI Eye Surgeries EVE Hospital\' vs official \'Navjyoti Eye Hospital\' (75% similarity < 95%). OCR ne sahi padha hai. Designer se theek karwao.\",\"phone_verification\":[{\"found_phone\":\"8817232247\",\"normalized_phone\":\"8817232247\",\"source\":\"caption\",\"edit_distance\":8,\"status\":\"unknown_phone\",\"message\":\"Unknown phone number mila jo registered numbers se match nahi karta: \'8817232247\' (caption)\"}],\"address_match_percentage\":36,\"address_warning\":null}', '2026-11-20 10:53:34', 96.87, 0, 'completed', 'completed', NULL, '{\"status\":\"PASS\",\"found\":true,\"score\":0.95,\"location\":\"top-left\",\"location_hindi\":\"Upar Left corner me\",\"size_percent\":20,\"reason\":\"CORRECT\",\"suggestion\":\"Logo perfectly placed hai top-left corner mein, sab theek hai.\",\"checked_by\":\"Gemini\"}', 'python', 1, 'gemini_failed', 'green_clean'),
(30, 16, 29, '[{\"word\":\"BrandGrowt\",\"script\":\"english\",\"suggestion\":\"BrandGrowth\",\"suggestions\":[\"BrandGrowth\"],\"reason\":\"The hashtag contains a spelling error; it should be \'BrandGrowth\'.\",\"source\":\"text\"}]', '[]', 'null', 'DOAGURU INFOSYSTEMS\nTransforming Technically\nYOUR COMPETITOR\nISN\'T PLAYING\nHARDER.\nTHEY\'RE PLAYING\nSMARTER.\nEvery move is backed by strategy.\nThat\'s what creates sustainable growth.\nwww.doaguru.com\ninfo@doaguru.com\n+91 7000102121', '[{\"id\":1,\"section\":\"1. Region: DOAGURU INFOSYSTEMS\",\"rect\":{\"left\":74.17,\"top\":8.07,\"width\":14.54,\"height\":1.33},\"poster_expected\":\"DOAGURU INFOSYSTEMS\",\"ocr_read\":\"DOAGURU INFOSYSTEMS\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":99,\"reason\":\"Isolated UI element — spelling check skipped (UI chrome).\",\"region_type\":\"isolated_element\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":2,\"section\":\"2. Region: Transforming Technically\",\"rect\":{\"left\":74.26,\"top\":8.74,\"width\":14.35,\"height\":1},\"poster_expected\":\"Transforming Technically\",\"ocr_read\":\"Transforming Technically\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":98,\"reason\":\"Isolated UI element — spelling check skipped (UI chrome).\",\"region_type\":\"isolated_element\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":3,\"section\":\"3. Region: YOUR COMPETITOR\",\"rect\":{\"left\":3.98,\"top\":11.26,\"width\":50.19,\"height\":4.07},\"poster_expected\":\"YOUR COMPETITOR\",\"ocr_read\":\"YOUR COMPETITOR\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":99,\"reason\":\"Verified OK (Confidence 99%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":4,\"section\":\"4. Region: ISN\'T PLAYING\",\"rect\":{\"left\":3.98,\"top\":15.78,\"width\":39.54,\"height\":5.11},\"poster_expected\":\"ISN\'T PLAYING\",\"ocr_read\":\"ISN\'T PLAYING\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":99,\"reason\":\"Verified OK (Confidence 99%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":5,\"section\":\"5. Region: HARDER.\",\"rect\":{\"left\":3.98,\"top\":20.67,\"width\":25.65,\"height\":4.07},\"poster_expected\":\"HARDER.\",\"ocr_read\":\"HARDER.\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":99,\"reason\":\"Verified OK (Confidence 99%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":6,\"section\":\"6. Region: THEY\'RE PLAYING\",\"rect\":{\"left\":3.98,\"top\":26.22,\"width\":51.11,\"height\":4.07},\"poster_expected\":\"THEY\'RE PLAYING\",\"ocr_read\":\"THEY\'RE PLAYING\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":99,\"reason\":\"Verified OK (Confidence 99%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":7,\"section\":\"7. Region: SMARTER.\",\"rect\":{\"left\":3.98,\"top\":31.33,\"width\":31.57,\"height\":4.07},\"poster_expected\":\"SMARTER.\",\"ocr_read\":\"SMARTER.\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":99,\"reason\":\"Verified OK (Confidence 99%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":8,\"section\":\"8. Region: Every move is backed by strategy...\",\"rect\":{\"left\":19.17,\"top\":63.85,\"width\":55.09,\"height\":1.26},\"poster_expected\":\"Every move is backed by strategy.\",\"ocr_read\":\"Every move is backed by strategy.\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":98,\"reason\":\"Verified OK (Confidence 98%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":9,\"section\":\"9. Region: That\'s what creates sustainable ...\",\"rect\":{\"left\":19.17,\"top\":65.78,\"width\":61.02,\"height\":1.33},\"poster_expected\":\"That\'s what creates sustainable growth.\",\"ocr_read\":\"That\'s what creates sustainable growth.\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":98,\"reason\":\"Verified OK (Confidence 98%).\",\"region_type\":\"prose\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":10,\"section\":\"10. Region: www.doaguru.com\",\"rect\":{\"left\":14.17,\"top\":71.26,\"width\":15.28,\"height\":1},\"poster_expected\":\"🌐 Visit: www.doaguru.com\",\"ocr_read\":\"www.doaguru.com\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":99,\"reason\":\"Verified OK (Confidence 99%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[{\"type\":\"url\",\"value\":\"www.doaguru.com\",\"start\":0,\"end\":15}],\"suspect_words\":[]},{\"id\":11,\"section\":\"11. Region: info@doaguru.com\",\"rect\":{\"left\":41.39,\"top\":71.26,\"width\":15,\"height\":1},\"poster_expected\":\"🌐 Visit: www.doaguru.com\",\"ocr_read\":\"info@doaguru.com\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":99,\"reason\":\"Verified OK (Confidence 99%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[{\"type\":\"email\",\"value\":\"info@doaguru.com\",\"start\":0,\"end\":16},{\"type\":\"url\",\"value\":\"doaguru.com\",\"start\":5,\"end\":16}],\"suspect_words\":[]},{\"id\":12,\"section\":\"12. Region: +91 7000102121\",\"rect\":{\"left\":68.33,\"top\":71.26,\"width\":11.67,\"height\":1},\"poster_expected\":\"+91 7000102121\",\"ocr_read\":\"+91 7000102121\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":99,\"reason\":\"Verified OK (Confidence 99%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[{\"type\":\"phone\",\"value\":\"91 7000102121\",\"start\":1,\"end\":14}],\"suspect_words\":[]}]', '[]', '[\"Consult Dr Rukmendra Pratap Singh Warkade at Navjyoti Eye Hospital\",\"#NavjyotiEyeHospital\",\"#EyeCareJabalpur\",\"#CataractSurgeryJabalpur\"]', '{\"brand_name_correct\":false,\"brand_name_match_score\":44,\"matched_brand_text\":\"what creates sustainable\",\"possible_brand_name_error\":null,\"phone_verification\":[{\"found_phone\":\"+91 7440992424\",\"normalized_phone\":\"7440992424\",\"source\":\"caption\",\"edit_distance\":9,\"status\":\"unknown_phone\",\"message\":\"Unknown phone number mila jo registered numbers se match nahi karta: \'+91 7440992424\' (caption)\"}],\"address_match_percentage\":0,\"address_warning\":null}', '2026-11-20 11:53:32', 99.00, 0, 'completed', 'completed', NULL, '{\"status\":\"FAIL\",\"found\":false,\"score\":0,\"location\":\"unknown\",\"location_hindi\":\"Kahin nahi mila\",\"size_percent\":0,\"reason\":\"MISSING\",\"suggestion\":\"Logo post me kahin nahi mila. Logo ko post me lagayein.\",\"checked_by\":\"Gemini\"}', 'gemini', 0, 'none', 'green_clean'),
(31, 16, 30, '[{\"word\":\"Arent\",\"script\":\"english\",\"suggestions\":[\"Agent\",\"Anent\",\"Ardent\",\"Aren\'t\",\"Arena\"],\"source\":\"text\"},{\"word\":\"todays\",\"script\":\"english\",\"suggestions\":[\"today\",\"today\'s\"],\"source\":\"text\"},{\"word\":\"isnt\",\"script\":\"english\",\"suggestions\":[\"inst\",\"int\",\"isn\'t\"],\"source\":\"text\"},{\"word\":\"Doaguru\",\"script\":\"english\",\"suggestions\":[],\"source\":\"text\"},{\"word\":\"Infosystems\",\"script\":\"english\",\"suggestions\":[],\"source\":\"text\"},{\"word\":\"Dont\",\"script\":\"english\",\"suggestions\":[\"Cont\",\"Dent\",\"Dint\",\"Done\",\"Dong\"],\"source\":\"text\"},{\"word\":\"fransforming\",\"script\":\"english\",\"suggestions\":[\"transforming\"],\"source\":\"image\"},{\"word\":\"Thats\",\"script\":\"english\",\"suggestions\":[\"Ghats\",\"Thaws\",\"Whats\",\"Thatch\",\"Chats\"],\"source\":\"image\"}]', '[]', '{\"service\":\"gemini_ai\",\"code\":\"GEMINI_DUMMY_MODE\",\"user_message\":\"Gemini DUMMY mode me hai, Python fallback se check kiya gaya.\"}', '0l-\ndoaguru INFOSYSTEMS\nfransforming Technically\nYOUR COMPETITOR\nPLAYING\nHARDER.\nTHEY\'RE PLAYING\nSMARTER.\nEvery move is backed by strategy.\nThat\'s what creates sustainable growth\nwww.doaguru.com\ninfo@doaguru.com\n+917000102121', '[{\"id\":1,\"section\":\"1. Region: 0l-\",\"rect\":{\"left\":82.13,\"top\":4.07,\"width\":11.76,\"height\":6.37},\"poster_expected\":\"0l-\",\"ocr_read\":\"0l-\",\"status\":\"yellow\",\"status_label\":\"YELLOW = OCR Doubt\",\"confidence\":65,\"reason\":\"OCR Doubt: Low confidence (65% < 80%). Font styling or complex character ligature.\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":2,\"section\":\"2. Region: doaguru INFOSYSTEMS\",\"rect\":{\"left\":79.91,\"top\":10.3,\"width\":16.02,\"height\":1.93},\"poster_expected\":\"doaguru INFOSYSTEMS\",\"ocr_read\":\"doaguru INFOSYSTEMS\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":97,\"reason\":\"Isolated UI element — spelling check skipped (UI chrome).\",\"region_type\":\"isolated_element\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":3,\"section\":\"3. Region: fransforming Technically\",\"rect\":{\"left\":80.56,\"top\":11.56,\"width\":15.19,\"height\":1.19},\"poster_expected\":\"fransforming Technically\",\"ocr_read\":\"fransforming Technically\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":95,\"reason\":\"Isolated UI element — spelling check skipped (UI chrome).\",\"region_type\":\"isolated_element\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":4,\"section\":\"4. Region: YOUR COMPETITOR\",\"rect\":{\"left\":4.91,\"top\":15.33,\"width\":48.98,\"height\":4.89},\"poster_expected\":\"YOUR COMPETITOR\",\"ocr_read\":\"YOUR COMPETITOR\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":97,\"reason\":\"Verified OK (Confidence 97%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":5,\"section\":\"5. Region: SN\'T PLAYING\",\"rect\":{\"left\":5.09,\"top\":21.85,\"width\":37.13,\"height\":4.74},\"poster_expected\":\"SN\'T PLAYING\",\"ocr_read\":\"SN\'T PLAYING\",\"status\":\"yellow\",\"status_label\":\"YELLOW = OCR Doubt\",\"confidence\":94,\"reason\":\"OCR Doubt: OCR Noise detected in token \'SN\'T\' (unpronounceable_consonant_cluster (zero vowels in Latin token)). Unclear visual region on poster.\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":6,\"section\":\"6. Region: HARDER.\",\"rect\":{\"left\":4.72,\"top\":28,\"width\":22.5,\"height\":5.11},\"poster_expected\":\"HARDER.\",\"ocr_read\":\"HARDER.\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":91,\"reason\":\"Verified OK (Confidence 91%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":7,\"section\":\"7. Region: THEY\'RE PLAYING\",\"rect\":{\"left\":4.91,\"top\":35.85,\"width\":49.91,\"height\":4.96},\"poster_expected\":\"THEY\'RE PLAYING\",\"ocr_read\":\"THEY\'RE PLAYING\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":96,\"reason\":\"Verified OK (Confidence 96%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":8,\"section\":\"8. Region: SMARTER.\",\"rect\":{\"left\":4.72,\"top\":42.59,\"width\":28.61,\"height\":5.41},\"poster_expected\":\"SMARTER.\",\"ocr_read\":\"SMARTER.\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":98,\"reason\":\"Verified OK (Confidence 98%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":9,\"section\":\"9. Region: Every move is backed by strategy...\",\"rect\":{\"left\":20.46,\"top\":85.85,\"width\":39.07,\"height\":2.37},\"poster_expected\":\"Every move is backed by strategy.\",\"ocr_read\":\"Every move is backed by strategy.\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":97,\"reason\":\"Verified OK (Confidence 97%).\",\"region_type\":\"prose\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":10,\"section\":\"10. Region: That\'s what creates sustainable ...\",\"rect\":{\"left\":20.74,\"top\":88.52,\"width\":44.63,\"height\":2.22},\"poster_expected\":\"That\'s what creates sustainable growth\",\"ocr_read\":\"That\'s what creates sustainable growth\",\"status\":\"red\",\"status_label\":\"RED = Real Error\",\"confidence\":98,\"reason\":\"Spelling error detected on poster: \\\"Thats\\\"\",\"region_type\":\"prose\",\"pattern_tags\":[],\"suspect_words\":[]},{\"id\":11,\"section\":\"11. Region: www.doaguru.com\",\"rect\":{\"left\":15.37,\"top\":96.22,\"width\":16.39,\"height\":1.48},\"poster_expected\":\"🌐 Visit: www.doaguru.com\",\"ocr_read\":\"www.doaguru.com\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":100,\"reason\":\"Verified OK (Confidence 100%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[{\"type\":\"url\",\"value\":\"www.doaguru.com\",\"start\":0,\"end\":15}],\"suspect_words\":[]},{\"id\":12,\"section\":\"12. Region: info@doaguru.com\",\"rect\":{\"left\":44.54,\"top\":96.15,\"width\":16.57,\"height\":1.78},\"poster_expected\":\"🌐 Visit: www.doaguru.com\",\"ocr_read\":\"info@doaguru.com\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":100,\"reason\":\"Verified OK (Confidence 100%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[{\"type\":\"email\",\"value\":\"info@doaguru.com\",\"start\":0,\"end\":16},{\"type\":\"url\",\"value\":\"doaguru.com\",\"start\":5,\"end\":16}],\"suspect_words\":[]},{\"id\":13,\"section\":\"13. Region: +917000102121\",\"rect\":{\"left\":73.98,\"top\":96.07,\"width\":12.78,\"height\":1.7},\"poster_expected\":\"+917000102121\",\"ocr_read\":\"+917000102121\",\"status\":\"green\",\"status_label\":\"GREEN = OK\",\"confidence\":99,\"reason\":\"Verified OK (Confidence 99%).\",\"region_type\":\"uncertain\",\"pattern_tags\":[{\"type\":\"phone\",\"value\":\"917000102121\",\"start\":1,\"end\":13}],\"suspect_words\":[]}]', '[]', '[\"Consult Dr Rukmendra Pratap Singh Warkade at Navjyoti Eye Hospital\",\"#NavjyotiEyeHospital\",\"#EyeCareJabalpur\",\"#CataractSurgeryJabalpur\"]', '{\"brand_name_correct\":false,\"brand_name_match_score\":44,\"matched_brand_text\":\"what creates sustainable\",\"possible_brand_name_error\":null,\"phone_verification\":[{\"found_phone\":\"+91 7440992424\",\"normalized_phone\":\"7440992424\",\"source\":\"caption\",\"edit_distance\":9,\"status\":\"unknown_phone\",\"message\":\"Unknown phone number mila jo registered numbers se match nahi karta: \'+91 7440992424\' (caption)\"}],\"address_match_percentage\":0,\"address_warning\":null}', '2026-11-20 11:57:49', 94.32, 0, 'completed', 'completed', NULL, '{\"status\":\"FAIL\",\"found\":false,\"score\":0.57,\"location\":\"unknown\",\"location_hindi\":\"Kahin nahi mila\",\"size_percent\":0,\"reason\":\"MISSING\",\"suggestion\":\"Logo post me kahin nahi mila. Logo ko post me lagayein.\",\"checked_by\":\"Python\"}', 'python', 1, 'dummy_mode', 'green_clean');

-- --------------------------------------------------------

--
-- Table structure for table `clients`
--

CREATE TABLE `clients` (
  `id` int(11) NOT NULL,
  `name` varchar(150) NOT NULL,
  `primary_phone` varchar(30) DEFAULT NULL,
  `alternate_phone` varchar(30) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `gmb_url` varchar(500) DEFAULT NULL,
  `gmb_place_id` varchar(200) DEFAULT NULL,
  `gmb_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`gmb_snapshot`)),
  `gmb_last_synced_at` datetime DEFAULT NULL,
  `gmb_auto_whitelist` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`gmb_auto_whitelist`)),
  `created_by_admin_id` int(11) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `clients`
--

INSERT INTO `clients` (`id`, `name`, `primary_phone`, `alternate_phone`, `address`, `gmb_url`, `gmb_place_id`, `gmb_snapshot`, `gmb_last_synced_at`, `gmb_auto_whitelist`, `created_by_admin_id`, `is_active`, `created_at`) VALUES
(1, 'Balgopal Children\'s Neuro Clinic', '8989590477', '8447096306', '1063, near Jan Jyoti Hospital, Gole Bazar, Wright Town, Jabalpur, Madhya Pradesh', NULL, NULL, NULL, NULL, NULL, 3, 1, '2026-11-14 07:19:59'),
(2, 'Zenith Organics', '9123456789', '9123456780', 'Suite 404, Tech Park, Bangalore', NULL, NULL, NULL, NULL, NULL, 3, 0, '2026-11-14 13:09:30'),
(11, 'DOAGuru InfoSystems', '7477253424', '7440992424', '1815, Wright Town, Jabalpur, Madhya Pradesh 482002', 'https://share.google/tMNi7hBz4SI7nH3cs', NULL, NULL, NULL, NULL, 3, 1, '2026-11-18 07:53:17'),
(14, 'Life Medicity Multi Speciality Hospital', '74893 23226', NULL, 'Aaga Chowk near baldeobagh (2.75 km) 482001, Madhya Pradesh 482002', 'https://share.google/cv9umuUFtGLN6hTFY', NULL, NULL, NULL, NULL, 3, 1, '2026-11-18 11:41:45'),
(15, 'Navjyoti Eye Hospital', '62688 75304', NULL, 'Address: 1637, Mastana Chowk Rd, Ranjhi, Bengali Colony, Jabalpur, Madhya Pradesh 482005', 'https://share.google/beHEoM9RUQWRrAjRG', NULL, NULL, NULL, NULL, 3, 1, '2026-11-20 09:13:24');

-- --------------------------------------------------------

--
-- Table structure for table `client_brand_guidelines`
--

CREATE TABLE `client_brand_guidelines` (
  `id` int(11) NOT NULL,
  `client_id` int(11) NOT NULL,
  `whitelist_words` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`whitelist_words`)),
  `banned_words` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`banned_words`)),
  `mandatory_phrases` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`mandatory_phrases`)),
  `reference_logo_url` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `client_brand_guidelines`
--

INSERT INTO `client_brand_guidelines` (`id`, `client_id`, `whitelist_words`, `banned_words`, `mandatory_phrases`, `reference_logo_url`, `created_at`, `updated_at`) VALUES
(1, 1, '[\"Balgopal\",\"balgopalchildrensneuroclinic\",\"Keswani\",\"Payal\",\"Jabalpur\",\"MBBS\",\"DNB\",\"Paediatrics\",\"OPD\",\"EEG\",\"Wright Town\",\"Gole Bazar\",\"Jan Jyoti\",\"Katni\",\"Damoh\",\"Rewa\",\"Narsinghpur\",\"Gadarwara\",\"Mandla\",\"बालगोपाल\",\"केसवानी\",\"पायल\",\"जबलपुर\",\"गोल बाजार\",\"कटनी\",\"दमोह\",\"रीवा\",\"नरसिंहपुर\",\"गाडरवारा\",\"मंडला\",\"मिर्गी\",\"दौरे\",\"बाल रोग\",\"तंत्रिका विज्ञान\",\"न्यूरोलॉजी\",\"राइट टाउन\",\"हॉस्पिटल\",\"जनज्योति\"]', '[\"guaranteed\",\"guarantee\",\"cure\",\"100% cure\",\"permanent cure\",\"miracle\",\"no side effects\",\"best doctor\",\"no risk\",\"instant relief\",\"fully cured\",\"गारंटी\",\"गारंटीशुदा\",\"इलाज की गारंटी\",\"चमत्कारी\",\"चमत्कार\",\"स्थायी इलाज\",\"पूरी तरह ठीक\",\"पूर्ण इलाज\",\"कोई साइड इफेक्ट नहीं\",\"कोई दुष्प्रभाव नहीं\",\"सबसे अच्छा डॉक्टर\",\"तुरंत आराम\"]', '[\"Consult Dr. Payal Keswani for personalized advice\",\"#BalgopalNeuroClinic\",\"डॉ पायल केसवानी से परामर्श लें\"]', NULL, '2026-11-14 07:19:59', '2026-11-20 05:46:15'),
(5, 2, '[\"Zenith\",\"Organics\",\"FitLife\",\"शुद्ध\"]', '[\"chemical\",\"fake\",\"guaranteed\"]', '[\"#ZenithPure\",\"100% Organic\"]', NULL, '2026-11-14 13:09:30', '2026-11-14 13:09:30'),
(14, 11, '[\"doaguru\",\"doaguruinfosystems\",\"DOAGuru\",\"Infosystems\",\"DOAGuru Infosystems\",\"Jabalpur\",\"Yadav Colony\",\"Ranital\",\"Nove Adaresh Colony\",\"Digital Marketing\",\"Digital Marketing Services\",\"Website Design\",\"Website Development\",\"Software Development\",\"Android App\",\"Mobile App\",\"SEO\",\"Search Engine Optimization\",\"Social Media Marketing\",\"Graphic Design\",\"Branding\",\"IT Solutions\",\"Jabalpur ka Best Digital Marketing\"]', '[\"guaranteed\",\"guarantee\",\"100% guarantee\",\"guaranteed ranking\",\"guaranteed 1st page\",\"guaranteed followers\",\"fake followers\",\"buy followers\",\"buy likes\",\"overnight results\",\"instant ranking\",\"scam\",\"fraud\",\"fake\",\"hack\",\"hacked\",\"free followers\",\"cheat\",\"crack\",\"piracy\"]', '[\"Consult DOAGuru Infosystems for Digital Growth\",\"#DOAGuruInfosystems\",\"#DigitalMarketingJabalpur\"]', '/uploads/logos/client_11_logo.png', '2026-11-18 07:53:17', '2026-11-20 09:04:19'),
(18, 14, '[\"Life Medicity\",\"Life Medicity Hospital\",\"Life Medicity Multi Speciality Hospital\",\"Daddaji Hospitals\",\"Daddaji Hospitals Pvt. Ltd.\",\"Cardiology\",\"Gastroenterology\",\"Neurology\",\"Neurosurgery\",\"Nephrology\",\"Urology\",\"Oncology\",\"Orthopaedics\",\"Gynaecology\",\"Obstetrics\",\"Paediatrics\",\"Anaesthesiology\",\"Dermatology\",\"Laparoscopy\",\"Endoscopy\",\"Colonoscopy\",\"Haematology\",\"Dialysis\",\"Bariatric Surgery\",\"Infertility\",\"Varicose Veins\",\"ICU\",\"NICU\",\"PICU\",\"ECG\",\"2D Echo\",\"NABH\",\"Multi Speciality\",\"Super Speciality\",\"Emergency Care\",\"Critical Care\",\"Cardiac Care\",\"Heart Care\",\"Joint Replacement\",\"Laser Piles Clinic\",\"Pain Clinic\",\"Infertility Centre\"]', '[\"100% Cure\",\"Guaranteed Cure\",\"Permanent Cure\",\"Instant Cure\",\"Miracle Treatment\",\"No Side Effects\",\"Zero Side Effects\",\"100% Safe\",\"Guaranteed Results\",\"Risk Free Treatment\",\"Painless Treatment\",\"Best Hospital\",\"No. 1 Hospital\",\"India\'s Best Hospital\",\"World\'s Best Hospital\",\"Cheapest Treatment\",\"Guaranteed Recovery\",\"Cure in One Day\",\"Complete Cure Guaranteed\",\"No Need for Surgery\",\"Avoid Surgery Completely\",\"100% Success Rate\",\"100 प्रतिशत इलाज की गारंटी\",\"जड़ से इलाज\",\"पक्का इलाज\",\"रामबाण इलाज\",\"चमत्कारी इलाज\",\"बिना किसी साइड इफेक्ट के\",\"एक दिन में ठीक\",\"गारंटीड रिकवरी\",\"पूरी तरह सुरक्षित इलाज\",\"सबसे अच्छा अस्पताल\",\"नंबर वन अस्पताल\"]', '[\"Consult a qualified doctor before starting any treatment\",\"Treatment depends on individual patient condition\",\"For appointments and enquiries contact Life Medicity Hospital\",\"उपचार से पहले योग्य चिकित्सक से परामर्श लें\",\"उपचार मरीज की व्यक्तिगत स्वास्थ्य स्थिति पर निर्भर करता है\",\"अधिक जानकारी एवं अपॉइंटमेंट के लिए अस्पताल से संपर्क करें\"]', NULL, '2026-11-18 11:41:45', '2026-11-18 12:15:44'),
(34, 15, '[\"Navjyoti\",\"Nav Jyoti\",\"Navjyoti Eye Hospital\",\"Dr Rukmendra Pratap Singh Warkade\",\"Rukmendra\",\"Warkade\",\"Ranjhi\",\"Mastana Chowk\",\"Pal Hospital\",\"Jabalpur\",\"Cataract\",\"Phaco\",\"Phacoemulsification\",\"IOL\",\"Intraocular Lens\",\"Oculoplasty\",\"Orbit\",\"Ptosis\",\"Glaucoma\",\"Retina\",\"Fundus\",\"Cornea\",\"Macular Degeneration\",\"Diabetic Retinopathy\",\"Retinoscopy\",\"Cycloplegic\",\"Refraction\",\"Contact Lens\",\"Eye Care\",\"Aankh\",\"Netra\",\"Motiyabind\",\"www\",\"com\",\"navjyotieyehospital\",\"navjyotihospital00\"]', '[\"guaranteed\",\"guarantee\",\"100% guarantee\",\"100% cure\",\"pakka ilaj\",\"jadoo\",\"chamatkar\",\"guaranteed vision\",\"guaranteed success\",\"no side effects\",\"bilkul dard nahi\",\"painless guarantee\",\"instant cure\",\"overnight cure\",\"fake\",\"fraud\",\"scam\",\"free surgery\",\"buy followers\",\"fake followers\",\"chashma hamesha ke liye khatam\",\"chashma utar jayega guarantee se\"]', '[\"Consult Dr Rukmendra Pratap Singh Warkade at Navjyoti Eye Hospital\",\"#NavjyotiEyeHospital\",\"#EyeCareJabalpur\",\"#CataractSurgeryJabalpur\"]', '/uploads/logos/client_15_logo.png', '2026-11-20 09:13:24', '2026-11-20 09:19:14');

-- --------------------------------------------------------

--
-- Table structure for table `client_social_accounts`
--

CREATE TABLE `client_social_accounts` (
  `id` int(11) NOT NULL,
  `client_id` int(11) NOT NULL,
  `platform` enum('instagram','facebook','linkedin','youtube') NOT NULL,
  `profile_url` varchar(500) DEFAULT NULL,
  `platform_username` varchar(200) DEFAULT NULL,
  `platform_id` varchar(200) DEFAULT NULL,
  `access_token_encrypted` text DEFAULT NULL,
  `refresh_token_encrypted` text DEFAULT NULL,
  `token_expires_at` datetime DEFAULT NULL,
  `refresh_token_expires_at` datetime DEFAULT NULL,
  `connection_method` enum('oauth','manual') DEFAULT NULL,
  `is_connected` tinyint(1) DEFAULT 0,
  `last_tested_at` datetime DEFAULT NULL,
  `last_error` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `client_social_accounts`
--

INSERT INTO `client_social_accounts` (`id`, `client_id`, `platform`, `profile_url`, `platform_username`, `platform_id`, `access_token_encrypted`, `refresh_token_encrypted`, `token_expires_at`, `refresh_token_expires_at`, `connection_method`, `is_connected`, `last_tested_at`, `last_error`, `created_at`, `updated_at`) VALUES
(1, 11, 'instagram', 'https://www.instagram.com/doaguru_infosystem/', 'doaguru_infosystem', 'ig_biz_999', NULL, NULL, NULL, NULL, NULL, 0, '2026-11-18 17:41:43', NULL, '2026-11-18 08:47:50', '2026-11-19 08:06:41'),
(2, 11, 'facebook', 'https://www.facebook.com/doaguruinfosystems/', 'doaguruinfosystems', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, '2026-11-18 08:47:50', '2026-11-19 08:06:41'),
(3, 11, 'youtube', 'https://www.youtube.com/@doaguru4230', '@doaguru4230', NULL, NULL, NULL, '2026-11-18 18:41:43', NULL, NULL, 0, '2026-11-18 17:41:43', NULL, '2026-11-18 08:47:50', '2026-11-18 12:11:43'),
(4, 11, 'linkedin', 'https://in.linkedin.com/company/doaguru-infosystem', 'doaguru-infosystem', NULL, '58faaf75e690a0b43b01e6f0c009514c:c140546e56e985001dd1556b33869583:d4cbccf54d1ccb71224aebaef46c7dfe8ff4531f10c972b81b16', NULL, '2026-12-18 17:41:43', NULL, NULL, 1, NULL, NULL, '2026-11-18 08:47:50', '2026-11-18 12:11:43'),
(5, 15, 'instagram', 'https://instagram.com/navjyotihospital00', 'navjyotihospital00', '40300875732890810', '4be4504d487a90b5e5cc44520cd325b9:3077a8daa746e36e94e53a7a64bdc47d:d44c1a7037f49cd40d874f3dbe1412b39038e824e0086a24b441e7b615d5d1dae25bb8c82ce35e1620b331a8cb69608f7ce4eea26628e04dd387c59553b39277de41e4157d0b2b1bf94a988411f9012259e7f62ed50683bb39d3cdee8fc3e72d773a91e7c7d933262ded6144d1807e6dfe60d46dbd0bc4646ba25032afabc672638b016ee13ae549caaa16df718f4f26d878c7c1571104aba2985a54bc3a4f017831dae0f2fadf371b24dd9f314810da71a4cda7e6de9a7a85be9dd48e466b429672c9f14adf0500f82f760790a040a52a467e29d1fda8', NULL, '2027-01-19 18:20:45', NULL, 'oauth', 1, '2026-11-20 18:20:45', NULL, '2026-11-20 11:08:11', '2026-11-20 12:50:45'),
(13, 14, 'instagram', 'https://instagram.com/lifemedicitymultispecialityhospital', 'lifemedicitymultispecialityhospital', '40300875732890810', '549a29c6f16b8c00dfddfca2d38e3dcf:9af67efab8629b473ad2a34eb358447f:5b77225be4794782d8be6140fdbffa8292996821b0fc370b9f18bac0b13fab3cce1fb4911431938f2f5ceaef9e30aabb0c63d5dae3e86e39ffcd291faa0c4c1ce31aa9f025194cc19e19d2bf063ce95e4abda9bea0d705fcf476721d450d17354b33898bbd5a964f2e990d73ff5fa88702974e1f164f0237bb6a964eb9bbade62f43d42ae593f049f0cbe0190809192591f05db263f3567950a3ede8ad56e9a61cbe2107702a03d1784dcfde7e9cb5aa3bfcb841e35d14995f2d094537e980508d030c7e05f4c783c57fb61e7fdb09075e1372fc', NULL, '2027-01-19 18:21:55', NULL, 'oauth', 1, '2026-11-20 18:21:55', NULL, '2026-11-20 12:51:55', '2026-11-20 12:51:55');

-- --------------------------------------------------------

--
-- Table structure for table `posts`
--

CREATE TABLE `posts` (
  `id` int(11) NOT NULL,
  `created_by` int(11) NOT NULL,
  `client_id` int(11) NOT NULL DEFAULT 1,
  `title` varchar(255) NOT NULL DEFAULT 'Untitled Campaign',
  `caption` text DEFAULT NULL,
  `image_path` varchar(255) DEFAULT NULL,
  `scheduled_at` datetime DEFAULT NULL,
  `status` enum('draft','ai_checking','pending_manager','pending_admin','admin_approved','ready_to_publish','scheduled','posted','failed','completed','changes_requested','rejected') NOT NULL DEFAULT 'ai_checking',
  `platform` enum('instagram','facebook') DEFAULT NULL,
  `target_platforms` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`target_platforms`)),
  `manual_publish_url` varchar(500) DEFAULT NULL,
  `publish_results` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`publish_results`)),
  `published_at` datetime DEFAULT NULL,
  `recheck_count` int(11) NOT NULL DEFAULT 0,
  `manual_review_required` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `posts`
--

INSERT INTO `posts` (`id`, `created_by`, `client_id`, `title`, `caption`, `image_path`, `scheduled_at`, `status`, `platform`, `target_platforms`, `manual_publish_url`, `publish_results`, `published_at`, `recheck_count`, `manual_review_required`, `created_at`, `updated_at`) VALUES
(15, 1, 15, 'निःशुल्क मोतियाबिंद ऑपरेशन – अब साफ़ और बेहतर दृष्टि का अवसर!', 'क्या धुंधली नज़र आपकी रोज़मर्रा की ज़िंदगी को मुश्किल बना रही है? अब चिंता छोड़िए और अपनी आँखों की सेहत का ध्यान रखिए।\r\n\r\nनवज्योति आई हॉस्पिटल में प्रत्येक माह की 12 तारीख को अनुभवी नेत्र विशेषज्ञ डॉ. आर.पी.एस. वर्माड़े द्वारा निःशुल्क मोतियाबिंद ऑपरेशन की सुविधा उपलब्ध है।\r\n\r\nहमारी विशेषताएँ:\r\n- अनुभवी नेत्र विशेषज्ञ द्वारा परामर्श\r\n- सुरक्षित एवं आधुनिक सर्जरी\r\n- विश्वसनीय नेत्र अस्पताल\r\n- बेहतर दृष्टि और स्वस्थ जीवन की पहल\r\nसमय: सुबह 11:00 बजे से दोपहर 3:00 बजे तक\r\n\r\nअभी अपॉइंटमेंट बुक करें:\r\n6268875304, 8817232247\r\n\r\nपता: पाल अस्पताल के सामने, मस्ताना चौक, रांझी, जबलपुर (म.प्र.)\r\n\r\nअपनी आँखों की रोशनी को नज़रअंदाज़ न करें। बेहतर दृष्टि के लिए आज ही संपर्क करें।\r\n\r\nनवज्योति आई हॉस्पिटल – सुरक्षित दृष्टि, बेहतर जीवन।', 'uploads/post-1795172011989-486837673.png', NULL, 'failed', 'instagram', '[\"instagram\"]', NULL, '[{\"platform\":\"instagram\",\"success\":false,\"error\":\"Unsupported request - method type: post\",\"user_message\":\"Failed to publish to instagram: Unsupported request - method type: post\"}]', '2026-11-20 17:32:10', 1, 0, '2026-11-20 10:46:42', '2026-11-20 12:02:10'),
(16, 1, 15, 'Your Competitors Aren\'t Working Harder. They\'re Marketing Smarter', 'In Business, Strategy Always Beats Random Moves\r\n\r\nYour competitors aren\'t necessarily spending more, posting more, or working longer.\r\n\r\nThey\'re making smarter, data-driven decisions that help their brands stand out.\r\n\r\n🚀 In today\'s competitive digital landscape, success isn\'t just about being visible. It\'s about reaching the right people, delivering the right message, and turning opportunities into measurable growth.\r\n\r\n💡 What Does Smarter Marketing Look Like?\r\n\r\n🎯 Targeted Campaigns – Reach audiences who are genuinely interested in your business.\r\n\r\n📊 Data-Driven Strategies – Make informed marketing decisions backed by performance insights.\r\n\r\n📱 Strategic Social Media Marketing – Build a meaningful presence across relevant platforms.\r\n\r\n🔍 SEO & Online Visibility – Help potential customers discover your business when they\'re searching.\r\n\r\n📈 Performance Optimization – Continuously refine campaigns for better efficiency and results.\r\n\r\nAt Doaguru Infosystems, we believe sustainable business growth starts with the right digital strategy.\r\n\r\n💙 Don\'t Just Compete. Think Ahead. Play Smarter. Grow Stronger.\r\n\r\nReady to make your next move count?\r\n\r\n📞 Contact: +91 7440992424\r\n📍 1815 Wright Town, Jabalpur, Madhya Pradesh, Bharat, 482002\r\n🌐 Visit: www.doaguru.com\r\n\r\nLet\'s Build Your Winning Digital Strategy\r\n\r\n#DoaguruInfosystems #DigitalMarketingAgency #DigitalMarketingStrategy #BusinessGrowthStrategy #PerformanceMarketing #SEOAgency #SocialMediaMarketing #DataDrivenMarketing #DigitalMarketingJabalpur #BrandGrowt', 'uploads/post-1795175609200-562665295.jpg', NULL, 'failed', 'instagram', '[\"instagram\"]', NULL, '[{\"platform\":\"instagram\",\"success\":false,\"error\":\"Instagram publishing failed at container creation (Step 1): Unsupported request - method type: post\",\"user_message\":\"Failed to publish to instagram: Instagram publishing failed at container creation (Step 1): Unsupported request - method type: post\"}]', '2026-11-20 17:52:42', 1, 0, '2026-11-20 11:53:32', '2026-11-20 12:22:42');

-- --------------------------------------------------------

--
-- Table structure for table `post_approvals`
--

CREATE TABLE `post_approvals` (
  `id` int(11) NOT NULL,
  `post_id` int(11) NOT NULL,
  `revision_id` int(11) DEFAULT NULL,
  `approver_id` int(11) NOT NULL,
  `role` enum('admin','manager') NOT NULL,
  `action` enum('approved','rejected','changes_requested') NOT NULL,
  `comment` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `post_approvals`
--

INSERT INTO `post_approvals` (`id`, `post_id`, `revision_id`, `approver_id`, `role`, `action`, `comment`, `created_at`) VALUES
(1, 15, 28, 2, 'manager', 'approved', NULL, '2026-11-20 11:10:26'),
(2, 15, 28, 3, 'admin', 'approved', NULL, '2026-11-20 11:10:45'),
(3, 16, 30, 2, 'manager', 'approved', NULL, '2026-11-20 12:20:09'),
(4, 16, 30, 3, 'admin', 'approved', NULL, '2026-11-20 12:20:36');

-- --------------------------------------------------------

--
-- Table structure for table `post_revisions`
--

CREATE TABLE `post_revisions` (
  `id` int(11) NOT NULL,
  `post_id` int(11) NOT NULL,
  `revision_number` int(11) NOT NULL DEFAULT 1,
  `title` varchar(255) DEFAULT NULL,
  `caption` text DEFAULT NULL,
  `image_path` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `post_revisions`
--

INSERT INTO `post_revisions` (`id`, `post_id`, `revision_number`, `title`, `caption`, `image_path`, `created_at`) VALUES
(27, 15, 1, 'निःशुल्क मोतियाबिंद ऑपरेशन – अब साफ़ और बेहतर दृष्टि का अवसर!', 'क्या धुंधली नज़र आपकी रोज़मर्रा की ज़िंदगी को मुश्किल बना रही है? अब चिंता छोड़िए और अपनी आँखों की सेहत का ध्यान रखिए।\r\n\r\nनवज्योति आई हॉस्पिटल में प्रत्येक माह की 12 तारीख को अनुभवी नेत्र विशेषज्ञ डॉ. आर.पी.एस. वर्माड़े द्वारा निःशुल्क मोतियाबिंद ऑपरेशन की सुविधा उपलब्ध है।\r\n\r\nहमारी विशेषताएँ:\r\n- अनुभवी नेत्र विशेषज्ञ द्वारा परामर्श\r\n- सुरक्षित एवं आधुनिक सर्जरी\r\n- विश्वसनीय नेत्र अस्पताल\r\n- बेहतर दृष्टि और स्वस्थ जीवन की पहल\r\nसमय: सुबह 11:00 बजे से दोपहर 3:00 बजे तक\r\n\r\nअभी अपॉइंटमेंट बुक करें:\r\n6268875304, 8817232247\r\n\r\nपता: पाल अस्पताल के सामने, मस्ताना चौक, रांझी, जबलपुर (म.प्र.)\r\n\r\nअपनी आँखों की रोशनी को नज़रअंदाज़ न करें। बेहतर दृष्टि के लिए आज ही संपर्क करें।\r\n\r\nनवज्योति आई हॉस्पिटल – सुरक्षित दृष्टि, बेहतर जीवन।', 'uploads/post-1795171598174-919765253.jpeg', '2026-11-20 10:46:42'),
(28, 15, 2, 'निःशुल्क मोतियाबिंद ऑपरेशन – अब साफ़ और बेहतर दृष्टि का अवसर!', 'क्या धुंधली नज़र आपकी रोज़मर्रा की ज़िंदगी को मुश्किल बना रही है? अब चिंता छोड़िए और अपनी आँखों की सेहत का ध्यान रखिए।\r\n\r\nनवज्योति आई हॉस्पिटल में प्रत्येक माह की 12 तारीख को अनुभवी नेत्र विशेषज्ञ डॉ. आर.पी.एस. वर्माड़े द्वारा निःशुल्क मोतियाबिंद ऑपरेशन की सुविधा उपलब्ध है।\r\n\r\nहमारी विशेषताएँ:\r\n- अनुभवी नेत्र विशेषज्ञ द्वारा परामर्श\r\n- सुरक्षित एवं आधुनिक सर्जरी\r\n- विश्वसनीय नेत्र अस्पताल\r\n- बेहतर दृष्टि और स्वस्थ जीवन की पहल\r\nसमय: सुबह 11:00 बजे से दोपहर 3:00 बजे तक\r\n\r\nअभी अपॉइंटमेंट बुक करें:\r\n6268875304, 8817232247\r\n\r\nपता: पाल अस्पताल के सामने, मस्ताना चौक, रांझी, जबलपुर (म.प्र.)\r\n\r\nअपनी आँखों की रोशनी को नज़रअंदाज़ न करें। बेहतर दृष्टि के लिए आज ही संपर्क करें।\r\n\r\nनवज्योति आई हॉस्पिटल – सुरक्षित दृष्टि, बेहतर जीवन।', 'uploads/post-1795172011989-486837673.png', '2026-11-20 10:53:34'),
(29, 16, 1, 'Your Competitors Aren\'t Working Harder. They\'re Marketing Smarter', 'In Business, Strategy Always Beats Random Moves\r\n\r\nYour competitors aren\'t necessarily spending more, posting more, or working longer.\r\n\r\nThey\'re making smarter, data-driven decisions that help their brands stand out.\r\n\r\n🚀 In today\'s competitive digital landscape, success isn\'t just about being visible. It\'s about reaching the right people, delivering the right message, and turning opportunities into measurable growth.\r\n\r\n💡 What Does Smarter Marketing Look Like?\r\n\r\n🎯 Targeted Campaigns – Reach audiences who are genuinely interested in your business.\r\n\r\n📊 Data-Driven Strategies – Make informed marketing decisions backed by performance insights.\r\n\r\n📱 Strategic Social Media Marketing – Build a meaningful presence across relevant platforms.\r\n\r\n🔍 SEO & Online Visibility – Help potential customers discover your business when they\'re searching.\r\n\r\n📈 Performance Optimization – Continuously refine campaigns for better efficiency and results.\r\n\r\nAt Doaguru Infosystems, we believe sustainable business growth starts with the right digital strategy.\r\n\r\n💙 Don\'t Just Compete. Think Ahead. Play Smarter. Grow Stronger.\r\n\r\nReady to make your next move count?\r\n\r\n📞 Contact: +91 7440992424\r\n📍 1815 Wright Town, Jabalpur, Madhya Pradesh, Bharat, 482002\r\n🌐 Visit: www.doaguru.com\r\n\r\nLet\'s Build Your Winning Digital Strategy\r\n\r\n#DoaguruInfosystems #DigitalMarketingAgency #DigitalMarketingStrategy #BusinessGrowthStrategy #PerformanceMarketing #SEOAgency #SocialMediaMarketing #DataDrivenMarketing #DigitalMarketingJabalpur #BrandGrowt', 'uploads/post-1795175609200-562665295.jpg', '2026-11-20 11:53:32'),
(30, 16, 2, 'Your Competitors Aren\'t Working Harder. They\'re Marketing Smarter', 'In Business, Strategy Always Beats Random Moves\r\n\r\nYour competitors aren\'t necessarily spending more, posting more, or working longer.\r\n\r\nThey\'re making smarter, data-driven decisions that help their brands stand out.\r\n\r\n🚀 In today\'s competitive digital landscape, success isn\'t just about being visible. It\'s about reaching the right people, delivering the right message, and turning opportunities into measurable growth.\r\n\r\n💡 What Does Smarter Marketing Look Like?\r\n\r\n🎯 Targeted Campaigns – Reach audiences who are genuinely interested in your business.\r\n\r\n📊 Data-Driven Strategies – Make informed marketing decisions backed by performance insights.\r\n\r\n📱 Strategic Social Media Marketing – Build a meaningful presence across relevant platforms.\r\n\r\n🔍 SEO & Online Visibility – Help potential customers discover your business when they\'re searching.\r\n\r\n📈 Performance Optimization – Continuously refine campaigns for better efficiency and results.\r\n\r\nAt Doaguru Infosystems, we believe sustainable business growth starts with the right digital strategy.\r\n\r\n💙 Don\'t Just Compete. Think Ahead. Play Smarter. Grow Stronger.\r\n\r\nReady to make your next move count?\r\n\r\n📞 Contact: +91 7440992424\r\n📍 1815 Wright Town, Jabalpur, Madhya Pradesh, Bharat, 482002\r\n🌐 Visit: www.doaguru.com\r\n\r\nLet\'s Build Your Winning Digital Strategy\r\n\r\n#DoaguruInfosystems #DigitalMarketingAgency #DigitalMarketingStrategy #BusinessGrowthStrategy #PerformanceMarketing #SEOAgency #SocialMediaMarketing #DataDrivenMarketing #DigitalMarketingJabalpur #BrandGrowt', 'uploads/post-1795175609200-562665295.jpg', '2026-11-20 11:57:49');

-- --------------------------------------------------------

--
-- Table structure for table `social_accounts`
--

CREATE TABLE `social_accounts` (
  `id` int(11) NOT NULL,
  `client_id` int(11) NOT NULL,
  `platform` enum('instagram','facebook') NOT NULL,
  `account_name` varchar(150) NOT NULL,
  `platform_account_id` varchar(100) NOT NULL,
  `connected_by_admin_id` int(11) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `social_account_tokens`
--

CREATE TABLE `social_account_tokens` (
  `id` int(11) NOT NULL,
  `social_account_id` int(11) NOT NULL,
  `access_token` text NOT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('admin','manager','smo') NOT NULL DEFAULT 'smo',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `role`, `created_at`) VALUES
(1, 'Rohan SMO', 'smo@test.com', '$2a$10$D1zVia0WGrkkkHH.GnfE2OUPNEQjcRfyOSnjk1wTF0wtzr8pgNKzS', 'smo', '2026-11-13 11:06:27'),
(2, 'Priya Manager', 'manager@test.com', '$2a$10$D1zVia0WGrkkkHH.GnfE2OUPNEQjcRfyOSnjk1wTF0wtzr8pgNKzS', 'manager', '2026-11-13 11:06:27'),
(3, 'Amit Admin', 'admin@test.com', '$2a$10$D1zVia0WGrkkkHH.GnfE2OUPNEQjcRfyOSnjk1wTF0wtzr8pgNKzS', 'admin', '2026-11-13 11:06:27');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `ai_check_results`
--
ALTER TABLE `ai_check_results`
  ADD PRIMARY KEY (`id`),
  ADD KEY `revision_id` (`revision_id`),
  ADD KEY `idx_ai_check_post` (`post_id`);

--
-- Indexes for table `clients`
--
ALTER TABLE `clients`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_clients_is_active` (`is_active`);

--
-- Indexes for table `client_brand_guidelines`
--
ALTER TABLE `client_brand_guidelines`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `client_id` (`client_id`);

--
-- Indexes for table `client_social_accounts`
--
ALTER TABLE `client_social_accounts`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uk_client_platform` (`client_id`,`platform`);

--
-- Indexes for table `posts`
--
ALTER TABLE `posts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_posts_status` (`status`),
  ADD KEY `idx_posts_created_by` (`created_by`),
  ADD KEY `idx_posts_client` (`client_id`);

--
-- Indexes for table `post_approvals`
--
ALTER TABLE `post_approvals`
  ADD PRIMARY KEY (`id`),
  ADD KEY `revision_id` (`revision_id`),
  ADD KEY `approver_id` (`approver_id`),
  ADD KEY `idx_approvals_post` (`post_id`);

--
-- Indexes for table `post_revisions`
--
ALTER TABLE `post_revisions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_revisions_post` (`post_id`,`revision_number`);

--
-- Indexes for table `social_accounts`
--
ALTER TABLE `social_accounts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `connected_by_admin_id` (`connected_by_admin_id`),
  ADD KEY `idx_social_client` (`client_id`,`platform`);

--
-- Indexes for table `social_account_tokens`
--
ALTER TABLE `social_account_tokens`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `social_account_id` (`social_account_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `idx_users_role` (`role`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `ai_check_results`
--
ALTER TABLE `ai_check_results`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=32;

--
-- AUTO_INCREMENT for table `clients`
--
ALTER TABLE `clients`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=16;

--
-- AUTO_INCREMENT for table `client_brand_guidelines`
--
ALTER TABLE `client_brand_guidelines`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=38;

--
-- AUTO_INCREMENT for table `client_social_accounts`
--
ALTER TABLE `client_social_accounts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;

--
-- AUTO_INCREMENT for table `posts`
--
ALTER TABLE `posts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=17;

--
-- AUTO_INCREMENT for table `post_approvals`
--
ALTER TABLE `post_approvals`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `post_revisions`
--
ALTER TABLE `post_revisions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=31;

--
-- AUTO_INCREMENT for table `social_accounts`
--
ALTER TABLE `social_accounts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `social_account_tokens`
--
ALTER TABLE `social_account_tokens`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `ai_check_results`
--
ALTER TABLE `ai_check_results`
  ADD CONSTRAINT `ai_check_results_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `ai_check_results_ibfk_2` FOREIGN KEY (`revision_id`) REFERENCES `post_revisions` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `client_brand_guidelines`
--
ALTER TABLE `client_brand_guidelines`
  ADD CONSTRAINT `client_brand_guidelines_ibfk_1` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `client_social_accounts`
--
ALTER TABLE `client_social_accounts`
  ADD CONSTRAINT `client_social_accounts_ibfk_1` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `posts`
--
ALTER TABLE `posts`
  ADD CONSTRAINT `fk_posts_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `posts_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `post_approvals`
--
ALTER TABLE `post_approvals`
  ADD CONSTRAINT `post_approvals_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `post_approvals_ibfk_2` FOREIGN KEY (`revision_id`) REFERENCES `post_revisions` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `post_approvals_ibfk_3` FOREIGN KEY (`approver_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `post_revisions`
--
ALTER TABLE `post_revisions`
  ADD CONSTRAINT `post_revisions_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `social_accounts`
--
ALTER TABLE `social_accounts`
  ADD CONSTRAINT `social_accounts_ibfk_1` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `social_accounts_ibfk_2` FOREIGN KEY (`connected_by_admin_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `social_account_tokens`
--
ALTER TABLE `social_account_tokens`
  ADD CONSTRAINT `social_account_tokens_ibfk_1` FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
